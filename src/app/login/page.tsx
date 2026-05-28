import { loginAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card">
        <h1 className="mb-1 text-xl font-semibold text-brand">🏡 HouseScore</h1>
        <p className="mb-4 text-sm text-slate-500">
          Enter the access password to continue.
        </p>
        {error ? (
          <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            Incorrect password.
          </p>
        ) : null}
        <form action={loginAction} className="space-y-3">
          <input type="hidden" name="next" value={next ?? "/"} />
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn w-full">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
