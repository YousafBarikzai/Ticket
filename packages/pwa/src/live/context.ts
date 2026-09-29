'use client';

import { createContext } from 'react';
import type { LiveHub } from './hub.js';

/**
 * The page's hub, when a `LiveProvider` is mounted above. Its own module so
 * the provider and the hooks can share it without importing each other.
 */
export const LiveContext = createContext<LiveHub | null>(null);
