import { ZodFirstPartyTypeKind, type ZodTypeAny } from 'zod';

/**
 * What kind of value a setting takes, read from the zod schema its manifest
 * declares.
 *
 * The console needs to know whether a setting is a choice, a number, a switch
 * or text before it can draw a control for it. Without this it kept its own
 * map of thirty keys to types, which is a second declaration of every setting
 * that nothing checked against the first: add a setting, or tighten a limit,
 * and the console went on offering the old one until somebody noticed a 422.
 * The manifest schema is the one the write is validated against, so it is the
 * one the control is drawn from.
 *
 * Structured values (`object`, `record`) are described field by field so a
 * console can draw them if it chooses; anything this cannot describe with
 * certainty is `json`, which a console shows read-only rather than guessing.
 */
export type SettingType =
  | { kind: 'enum'; options: string[] }
  | {
      kind: 'number';
      int: boolean;
      min?: number;
      max?: number;
      /** Present, and true, when `min` itself is not allowed (`z.number().gt(0)`). */
      minExclusive?: true;
      maxExclusive?: true;
    }
  | { kind: 'boolean' }
  /** `min` and `max` are lengths, in characters. */
  | { kind: 'string'; min?: number; max?: number }
  | { kind: 'object'; fields: Record<string, SettingType> }
  /** A map; `keys` when the keys are a fixed set. */
  | { kind: 'record'; keys?: string[]; value: SettingType }
  | { kind: 'json' };

type NumberType = Extract<SettingType, { kind: 'number' }>;
type StringType = Extract<SettingType, { kind: 'string' }>;

interface Check {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

/**
 * Read by `_def.typeName` rather than `instanceof`: the schemas come from
 * every module's manifest, and a module that resolved its own copy of zod
 * would fail an `instanceof` against this one and be described as `json`
 * without anyone being told.
 */
export function describeSchema(schema: ZodTypeAny): SettingType {
  const def = schema._def as Record<string, unknown> & { typeName?: string };

  switch (def.typeName) {
    // Wrappers change what may be omitted, not what a value is.
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodNullable:
    case ZodFirstPartyTypeKind.ZodDefault:
    case ZodFirstPartyTypeKind.ZodCatch:
    case ZodFirstPartyTypeKind.ZodReadonly:
      return describeSchema(def.innerType as ZodTypeAny);
    case ZodFirstPartyTypeKind.ZodBranded:
      return describeSchema(def.type as ZodTypeAny);
    // A refinement or transform is described by what it accepts. A refinement
    // can narrow further than the descriptor says; the write still validates
    // against the whole schema, so the worst case is a precise 422.
    case ZodFirstPartyTypeKind.ZodEffects:
      return describeSchema(def.schema as ZodTypeAny);
    case ZodFirstPartyTypeKind.ZodPipeline:
      return describeSchema(def.in as ZodTypeAny);

    case ZodFirstPartyTypeKind.ZodEnum:
      return { kind: 'enum', options: [...(def.values as string[])] };
    case ZodFirstPartyTypeKind.ZodNativeEnum: {
      const values = Object.values(def.values as Record<string, unknown>);
      // A numeric TypeScript enum carries its names as values too (the
      // reverse mapping), so only an all-string enum is a list of options.
      return values.every((value) => typeof value === 'string') ? { kind: 'enum', options: values as string[] } : { kind: 'json' };
    }
    case ZodFirstPartyTypeKind.ZodLiteral:
      return typeof def.value === 'string' ? { kind: 'enum', options: [def.value] } : { kind: 'json' };
    case ZodFirstPartyTypeKind.ZodUnion: {
      // A union of string literals is an enum spelled differently; any other
      // union has no single control.
      const options = (def.options as ZodTypeAny[]).map(describeSchema);
      return options.every((option) => option.kind === 'enum')
        ? { kind: 'enum', options: [...new Set(options.flatMap((option) => (option.kind === 'enum' ? option.options : [])))] }
        : { kind: 'json' };
    }

    case ZodFirstPartyTypeKind.ZodBoolean:
      return { kind: 'boolean' };
    case ZodFirstPartyTypeKind.ZodNumber:
      return describeNumber((def.checks as Check[] | undefined) ?? []);
    case ZodFirstPartyTypeKind.ZodString:
      return describeString((def.checks as Check[] | undefined) ?? []);

    case ZodFirstPartyTypeKind.ZodObject: {
      const shape = (def.shape as () => Record<string, ZodTypeAny>)();
      return { kind: 'object', fields: Object.fromEntries(Object.entries(shape).map(([name, field]) => [name, describeSchema(field)])) };
    }
    case ZodFirstPartyTypeKind.ZodRecord: {
      const keys = describeSchema(def.keyType as ZodTypeAny);
      return {
        kind: 'record',
        ...(keys.kind === 'enum' ? { keys: keys.options } : {}),
        value: describeSchema(def.valueType as ZodTypeAny),
      };
    }

    default:
      return { kind: 'json' };
  }
}

/** The tightest bounds the checks allow; when two bounds meet, the exclusive one is tighter. */
function describeNumber(checks: Check[]): NumberType {
  const type: NumberType = { kind: 'number', int: false };
  for (const check of checks) {
    if (check.kind === 'int') type.int = true;
    if (check.value === undefined) continue;
    const exclusive = check.inclusive === false;
    if (check.kind === 'min' && (type.min === undefined || check.value > type.min || (check.value === type.min && exclusive))) {
      type.min = check.value;
      if (exclusive) type.minExclusive = true;
      else delete type.minExclusive;
    }
    if (check.kind === 'max' && (type.max === undefined || check.value < type.max || (check.value === type.max && exclusive))) {
      type.max = check.value;
      if (exclusive) type.maxExclusive = true;
      else delete type.maxExclusive;
    }
  }
  return type;
}

function describeString(checks: Check[]): StringType {
  const type: StringType = { kind: 'string' };
  for (const check of checks) {
    if (check.value === undefined) continue;
    if ((check.kind === 'min' || check.kind === 'length') && (type.min === undefined || check.value > type.min)) type.min = check.value;
    if ((check.kind === 'max' || check.kind === 'length') && (type.max === undefined || check.value < type.max)) type.max = check.value;
  }
  return type;
}
