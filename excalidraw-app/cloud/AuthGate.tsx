import { useEffect, useState } from "react";

import { cloudAuth } from "./auth";

import "./AuthGate.scss";

const AUTH_CHANGED_EVENT = "excalidraw-cloud-auth-changed";

export const notifyCloudAuthChanged = () => {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
};

export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshSession = async () => {
    if (!cloudAuth) {
      setIsChecking(false);
      return;
    }

    const response = await cloudAuth.adapter.getSession();
    setIsSignedIn(Boolean((response as any).data?.user));
    setIsChecking(false);
  };

  useEffect(() => {
    refreshSession().catch(() => {
      setIsSignedIn(false);
      setIsChecking(false);
    });

    window.addEventListener(AUTH_CHANGED_EVENT, refreshSession);
    window.addEventListener("focus", refreshSession);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshSession);
      window.removeEventListener("focus", refreshSession);
    };
  }, []);

  const handleAuth = async () => {
    if (!cloudAuth) {
      setError("VITE_NEON_AUTH_URL is not configured");
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      if (mode === "sign-in") {
        await cloudAuth.adapter.signIn.email({
          email,
          password,
          rememberMe: true,
        });
      } else {
        await cloudAuth.adapter.signUp.email({
          email,
          password,
          name: email,
        });
      }

      notifyCloudAuthChanged();
      await refreshSession();
    } catch (error: any) {
      setError(error.message || "Authentication failed");
    } finally {
      setIsBusy(false);
    }
  };

  if (isChecking) {
    return <div className="AuthGate AuthGate--loading">Loading...</div>;
  }

  if (isSignedIn) {
    return <>{children}</>;
  }

  return (
    <div
      className="AuthGate"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="AuthGate__card">
        <div className="AuthGate__brand">Excalidraw</div>
        <div className="AuthGate__title">
          {mode === "sign-in" ? "Sign in to your workspace" : "Create account"}
        </div>
        <div className="AuthGate__copy">
          Cloud drawings, sharing, and AI features are tied to your account.
        </div>

        {!cloudAuth && (
          <div className="AuthGate__error">
            Set VITE_NEON_AUTH_URL to enable authentication.
          </div>
        )}

        <input
          className="AuthGate__input"
          placeholder="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="AuthGate__input"
          placeholder="Password"
          type="password"
          autoComplete={
            mode === "sign-in" ? "current-password" : "new-password"
          }
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleAuth();
            }
          }}
        />

        {error && <div className="AuthGate__error">{error}</div>}

        <button
          className="AuthGate__button AuthGate__button--primary"
          type="button"
          disabled={isBusy || !cloudAuth}
          onClick={handleAuth}
        >
          {isBusy ? "Working..." : mode === "sign-in" ? "Sign in" : "Sign up"}
        </button>
        <button
          className="AuthGate__button"
          type="button"
          onClick={() =>
            setMode((value) => (value === "sign-in" ? "sign-up" : "sign-in"))
          }
        >
          {mode === "sign-in" ? "Create account" : "Use sign in"}
        </button>
      </div>
    </div>
  );
};
