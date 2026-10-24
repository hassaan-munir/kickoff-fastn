import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Kickoff</h1>
        <p className="mb-6 text-sm text-slate-600">
          Onboard every new client across your tools in one step.
        </p>
        <LoginForm initialError={error ?? null} />
      </div>
    </main>
  );
}
