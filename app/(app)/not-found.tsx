import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto mt-12 max-w-md p-8 text-center">
      <div className="text-4xl font-semibold text-brand-500">404</div>
      <h1 className="mt-2 text-lg font-semibold">This page could not be found</h1>
      <p className="mt-1 text-sm text-muted">It may have been deleted, or it isn&apos;t shared with your role or company.</p>
      <Link href="/dashboard" className="btn-primary mt-5">Back to dashboard</Link>
    </div>
  );
}
