import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center p-6">
      <div className="text-center">
        <div className="text-5xl font-semibold text-brand-500">404</div>
        <h1 className="mt-2 text-lg font-semibold">This page could not be found</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or you may not have access to it.</p>
        <Link href="/dashboard" className="btn-primary mt-5">Go to dashboard</Link>
      </div>
    </div>
  );
}
