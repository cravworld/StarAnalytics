import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // No background of its own: letting the body's graph-paper ground show
        // through is the point — the login card sits on the pad like every other sheet.
      }}
    >
      <div className="card" style={{ width: 340, textAlign: "center" }}>
        <div className="logo-name" style={{ marginBottom: 2 }}>StarAnalytics</div>
        <div className="logo-sub" style={{ marginBottom: 20 }}>Nivin Pauly · Confidential</div>
        <form
          action={async () => {
            "use server";
            // Without redirectTo, Auth.js v5 falls back to the Referer header as the
            // post-login destination -- which is this same /login page, since that's
            // where the form was submitted from. Login then silently "succeeds" by
            // bouncing straight back here, indistinguishable from a failure.
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="btn btn-primary" style={{ width: "100%" }} type="submit">
            Sign in with Google
          </button>
        </form>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 14 }}>
          Access is restricted to the Nivin Pauly team.
        </div>
      </div>
    </div>
  );
}
