import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ReportForm } from '../../../components/ReportForm.js';

export const metadata: Metadata = { title: 'Report an issue' };

export default function ReportPage(): ReactNode {
  return (
    <div className="itsm-Page">
      <h1 className="itsm-Page__heading">Report an issue</h1>
      <p className="itsm-Page__lede">
        Tell us what is wrong in your own words. You can add more later, and somebody will reply on the ticket.
      </p>
      <ReportForm />
    </div>
  );
}
