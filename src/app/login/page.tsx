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
        background: "var(--bg)",
      }}
    >
      <div className="card" style={{ width: 340, textAlign: "center" }}>
        <div className="logo-name" style={{ marginBottom: 2 }}>StarAnalytics</div>
        <div className="logo-sub" style={{ marginBottom: 20 }}>Nivin Pauly · Confidential</div>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button className="btn btn-primary" style={{ width: "100%" }} type="submit">
            Sign in with Google
          </button>
        </form>
        <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 14 }}>
          Access is restricted to the Nivin Pauly team.
        </div>
      </div>
    </div>
  );
}
