import { getSceneVersion } from "@excalidraw/element";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { cloudAuth } from "./auth";
import {
  createDrawing,
  deleteDrawing,
  getDrawing,
  listDrawings,
  updateDrawing,
} from "./api";

import type { CloudDrawingSummary, CloudDrawing } from "./api";

import "./CloudSync.scss";

const AUTOSAVE_INTERVAL_MS = 2000;

const toCloudPayload = (excalidrawAPI: ExcalidrawImperativeAPI, title: string) => {
  const serialized = serializeAsJSON(
    excalidrawAPI.getSceneElementsIncludingDeleted(),
    excalidrawAPI.getAppState(),
    excalidrawAPI.getFiles(),
    "local",
  );
  const data = JSON.parse(serialized);

  return {
    title,
    elements: data.elements,
    appState: data.appState,
    files: data.files || {},
  };
};

const normalizeDrawing = (drawing: CloudDrawing) => ({
  elements: drawing.elements as readonly ExcalidrawElement[],
  appState: drawing.app_state,
  files: drawing.files as BinaryFiles,
});

export const CloudSync = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [drawings, setDrawings] = useState<CloudDrawingSummary[]>([]);
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState("Untitled");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const lastSavedVersionRef = useRef<number | null>(null);
  const lastSaveStartedAtRef = useRef(0);

  const authReady = Boolean(cloudAuth);

  const activeLabel = useMemo(() => {
    if (!isSignedIn) {
      return "Cloud drawings";
    }
    if (activeDrawingId) {
      return activeTitle;
    }
    return "Cloud drawings";
  }, [activeDrawingId, activeTitle, isSignedIn]);

  const refreshSession = async () => {
    if (!cloudAuth) {
      return;
    }

    const response = await cloudAuth.adapter.getSession();
    setIsSignedIn(Boolean((response as any).data?.user));
  };

  const refreshDrawings = async () => {
    const nextDrawings = await listDrawings();
    setDrawings(nextDrawings);
  };

  useEffect(() => {
    refreshSession().catch(() => {
      setIsSignedIn(false);
    });
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      refreshDrawings().catch((error: Error) => setError(error.message));
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (!activeDrawingId || !isSignedIn) {
      return;
    }

    const interval = window.setInterval(async () => {
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
      const version = getSceneVersion(elements);

      if (
        version === lastSavedVersionRef.current ||
        Date.now() - lastSaveStartedAtRef.current < AUTOSAVE_INTERVAL_MS
      ) {
        return;
      }

      lastSaveStartedAtRef.current = Date.now();
      setMessage("Saving...");

      try {
        await updateDrawing(
          activeDrawingId,
          toCloudPayload(excalidrawAPI, activeTitle),
        );
        lastSavedVersionRef.current = version;
        setMessage("Saved");
        await refreshDrawings();
      } catch (error: any) {
        setError(error.message || "Cloud save failed");
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [activeDrawingId, activeTitle, excalidrawAPI, isSignedIn]);

  const handleAuth = async () => {
    if (!cloudAuth) {
      setError("VITE_NEON_AUTH_URL is not configured");
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("");

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

      await refreshSession();
      await refreshDrawings();
      setMessage("Signed in");
    } catch (error: any) {
      setError(error.message || "Authentication failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!cloudAuth) {
      return;
    }

    await cloudAuth.adapter.signOut();
    setIsSignedIn(false);
    setDrawings([]);
    setActiveDrawingId(null);
    setMessage("Signed out");
  };

  const handleCreate = async () => {
    setIsBusy(true);
    setError("");
    setMessage("Creating...");

    try {
      const title = excalidrawAPI.getName() || "Untitled";
      const drawing = await createDrawing(toCloudPayload(excalidrawAPI, title));
      setActiveDrawingId(drawing.id);
      setActiveTitle(drawing.title);
      lastSavedVersionRef.current = getSceneVersion(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
      await refreshDrawings();
      setMessage("Created");
    } catch (error: any) {
      setError(error.message || "Create failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpen = async (id: string) => {
    setIsBusy(true);
    setError("");
    setMessage("Opening...");

    try {
      const drawing = await getDrawing(id);
      const data = normalizeDrawing(drawing);
      excalidrawAPI.addFiles(Object.values(data.files));
      excalidrawAPI.updateScene({
        elements: data.elements,
        appState: data.appState as any,
      });
      setActiveDrawingId(drawing.id);
      setActiveTitle(drawing.title);
      lastSavedVersionRef.current = getSceneVersion(data.elements);
      setMessage("Opened");
    } catch (error: any) {
      setError(error.message || "Open failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setIsBusy(true);
    setError("");

    try {
      await deleteDrawing(id);
      if (activeDrawingId === id) {
        setActiveDrawingId(null);
        lastSavedVersionRef.current = null;
      }
      await refreshDrawings();
      setMessage("Deleted");
    } catch (error: any) {
      setError(error.message || "Delete failed");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="CloudSync">
      <button
        className="CloudSync__toggle"
        type="button"
        onClick={() => setIsOpen((value) => !value)}
      >
        {activeLabel}
      </button>
      {isOpen && (
        <div className="CloudSync__panel">
          <div className="CloudSync__header">
            <span>{activeLabel}</span>
            <span className="CloudSync__status">{message}</span>
          </div>

          {!authReady && (
            <div className="CloudSync__message">
              Set VITE_NEON_AUTH_URL to enable cloud drawings.
            </div>
          )}

          {authReady && !isSignedIn && (
            <div className="CloudSync__form">
              <input
                className="CloudSync__input"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <input
                className="CloudSync__input"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="CloudSync__actions">
                <button
                  className="CloudSync__button CloudSync__button--primary"
                  type="button"
                  disabled={isBusy}
                  onClick={handleAuth}
                >
                  {mode === "sign-in" ? "Sign in" : "Sign up"}
                </button>
                <button
                  className="CloudSync__button"
                  type="button"
                  onClick={() =>
                    setMode((value) =>
                      value === "sign-in" ? "sign-up" : "sign-in",
                    )
                  }
                >
                  {mode === "sign-in" ? "Create account" : "Use sign in"}
                </button>
              </div>
            </div>
          )}

          {authReady && isSignedIn && (
            <>
              <div className="CloudSync__actions">
                <button
                  className="CloudSync__button CloudSync__button--primary"
                  type="button"
                  disabled={isBusy}
                  onClick={handleCreate}
                >
                  Save current
                </button>
                <button
                  className="CloudSync__button"
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    refreshDrawings().catch((error: Error) =>
                      setError(error.message),
                    )
                  }
                >
                  Refresh
                </button>
                <button
                  className="CloudSync__button"
                  type="button"
                  disabled={isBusy}
                  onClick={handleSignOut}
                >
                  Sign out
                </button>
              </div>

              <div className="CloudSync__list">
                {drawings.map((drawing) => (
                  <div className="CloudSync__drawing" key={drawing.id}>
                    <div>
                      <div className="CloudSync__drawingTitle">
                        {drawing.title}
                      </div>
                      <div className="CloudSync__drawingMeta">
                        {new Date(drawing.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="CloudSync__actions">
                      <button
                        className="CloudSync__button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleOpen(drawing.id)}
                      >
                        Open
                      </button>
                      <button
                        className="CloudSync__button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDelete(drawing.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {error && (
            <div className="CloudSync__message CloudSync__danger">{error}</div>
          )}
        </div>
      )}
    </div>
  );
};
