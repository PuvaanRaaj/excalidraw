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
  createShareLink,
  deleteDrawing,
  deleteShareLink,
  getDrawing,
  listDrawingVersions,
  listDrawings,
  listShareLinks,
  restoreDrawing,
  restoreDrawingVersion,
  updateDrawing,
} from "./api";

import type {
  CloudDrawingSummary,
  CloudDrawing,
  CloudDrawingVersion,
  CloudShareLink,
  CloudSharePermission,
} from "./api";

import "./CloudSync.scss";

const AUTOSAVE_INTERVAL_MS = 2000;

const makeUntitledTitle = () =>
  `Untitled ${new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

const normalizeTags = (tags: string) =>
  tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const formatTags = (tags?: string[] | null) => (tags || []).join(", ");

const isDrawingStarred = (drawing: CloudDrawingSummary | CloudDrawing) =>
  Boolean(drawing.starred ?? drawing.is_starred);

const isDrawingTrashed = (drawing: CloudDrawingSummary | CloudDrawing) =>
  Boolean(drawing.trashed_at || drawing.deleted_at);

const getShareId = (share: CloudShareLink) =>
  share.shareId || share.share_id || share.id || "";

const getVersionId = (version: CloudDrawingVersion) =>
  version.versionId || version.version_id || version.id || "";

const toCloudPayload = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  title: string,
  metadata: {
    folder: string;
    tags: string;
    starred: boolean;
  },
) => {
  const serialized = serializeAsJSON(
    excalidrawAPI.getSceneElementsIncludingDeleted(),
    excalidrawAPI.getAppState(),
    excalidrawAPI.getFiles(),
    "local",
  );
  const data = JSON.parse(serialized);

  return {
    title,
    folder: metadata.folder.trim(),
    tags: normalizeTags(metadata.tags),
    starred: metadata.starred,
    isStarred: metadata.starred,
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
  const [activeTitle, setActiveTitle] = useState(makeUntitledTitle);
  const [activeFolder, setActiveFolder] = useState("");
  const [activeTags, setActiveTags] = useState("");
  const [activeStarred, setActiveStarred] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"active" | "starred" | "trash">("active");
  const [sharePermission, setSharePermission] =
    useState<CloudSharePermission>("view");
  const [shareLinks, setShareLinks] = useState<CloudShareLink[]>([]);
  const [versions, setVersions] = useState<CloudDrawingVersion[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  const lastSavedVersionRef = useRef<number | null>(null);
  const lastSaveStartedAtRef = useRef(0);

  const authReady = Boolean(cloudAuth);
  const activeMetadata = useMemo(
    () => ({
      folder: activeFolder,
      tags: activeTags,
      starred: activeStarred,
    }),
    [activeFolder, activeStarred, activeTags],
  );

  const activeLabel = useMemo(() => {
    if (!isSignedIn) {
      return "Cloud drawings";
    }
    if (activeDrawingId) {
      return activeTitle;
    }
    return "Unsaved canvas";
  }, [activeDrawingId, activeTitle, isSignedIn]);

  const filteredDrawings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return drawings.filter((drawing) => {
      const trashed = isDrawingTrashed(drawing);
      const starred = isDrawingStarred(drawing);

      if (view === "trash" && !trashed) {
        return false;
      }
      if (view === "starred" && (!starred || trashed)) {
        return false;
      }
      if (view === "active" && trashed) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        drawing.title,
        drawing.folder || "",
        ...(drawing.tags || []),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [drawings, searchQuery, view]);

  const makeShareUrl = (shareId: string) => {
    return `${window.location.origin}/shared/${shareId}`;
  };

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

  const refreshShareLinks = async (id = activeDrawingId) => {
    if (!id) {
      setShareLinks([]);
      return;
    }
    setShareLinks(await listShareLinks(id));
  };

  const refreshVersions = async (id = activeDrawingId) => {
    if (!id) {
      setVersions([]);
      return;
    }
    setVersions(await listDrawingVersions(id));
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
          toCloudPayload(excalidrawAPI, activeTitle, activeMetadata),
        );
        lastSavedVersionRef.current = version;
        setMessage("Saved");
        await refreshDrawings();
      } catch (error: any) {
        setError(error.message || "Cloud save failed");
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [activeDrawingId, activeMetadata, activeTitle, excalidrawAPI, isSignedIn]);

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
    setShareLinks([]);
    setVersions([]);
    setMessage("Signed out");
  };

  const saveDrawing = async (forceNew = false) => {
    setIsBusy(true);
    setError("");
    setMessage(forceNew || !activeDrawingId ? "Creating..." : "Saving...");

    try {
      const title = activeTitle.trim() || makeUntitledTitle();
      const payload = toCloudPayload(excalidrawAPI, title, activeMetadata);
      const drawing =
        activeDrawingId && !forceNew
          ? await updateDrawing(activeDrawingId, payload)
          : await createDrawing(payload);

      setActiveDrawingId(drawing.id);
      setActiveTitle(drawing.title);
      setActiveFolder(drawing.folder || payload.folder || "");
      setActiveTags(formatTags(drawing.tags || payload.tags));
      setActiveStarred(isDrawingStarred(drawing) || payload.starred);
      lastSavedVersionRef.current = getSceneVersion(
        excalidrawAPI.getSceneElementsIncludingDeleted(),
      );
      await refreshDrawings();
      await Promise.all([
        refreshShareLinks(drawing.id).catch(() => setShareLinks([])),
        refreshVersions(drawing.id).catch(() => setVersions([])),
      ]);
      setMessage("Saved");
    } catch (error: any) {
      setError(error.message || "Save failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleNewCanvas = () => {
    excalidrawAPI.resetScene({ resetLoadingState: true });
    setActiveDrawingId(null);
    setActiveTitle(makeUntitledTitle());
    setActiveFolder("");
    setActiveTags("");
    setActiveStarred(false);
    setShareLinks([]);
    setVersions([]);
    lastSavedVersionRef.current = getSceneVersion([]);
    setError("");
    setMessage("New canvas");
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
      setActiveFolder(drawing.folder || "");
      setActiveTags(formatTags(drawing.tags));
      setActiveStarred(isDrawingStarred(drawing));
      lastSavedVersionRef.current = getSceneVersion(data.elements);
      await Promise.all([
        refreshShareLinks(drawing.id).catch(() => setShareLinks([])),
        refreshVersions(drawing.id).catch(() => setVersions([])),
      ]);
      setMessage("Opened");
    } catch (error: any) {
      setError(error.message || "Open failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    const drawing = drawings.find((drawing) => drawing.id === id);
    const label = drawing?.title || "this drawing";

    if (!window.confirm(`Move "${label}" to trash?`)) {
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      await deleteDrawing(id);
      if (activeDrawingId === id) {
        setActiveDrawingId(null);
        setShareLinks([]);
        setVersions([]);
        lastSavedVersionRef.current = null;
      }
      await refreshDrawings();
      setMessage("Moved to trash");
    } catch (error: any) {
      setError(error.message || "Delete failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRestoreDrawing = async (id: string) => {
    setIsBusy(true);
    setError("");
    setMessage("Restoring...");

    try {
      await restoreDrawing(id);
      await refreshDrawings();
      setMessage("Restored");
    } catch (error: any) {
      setError(error.message || "Restore failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateShareLink = async () => {
    if (!activeDrawingId) {
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("Creating link...");

    try {
      await createShareLink(activeDrawingId, sharePermission);
      await refreshShareLinks(activeDrawingId);
      setMessage("Share link created");
    } catch (error: any) {
      setError(error.message || "Share link failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteShareLink = async (shareId: string) => {
    if (!activeDrawingId) {
      return;
    }

    setIsBusy(true);
    setError("");

    try {
      await deleteShareLink(activeDrawingId, shareId);
      await refreshShareLinks(activeDrawingId);
      setMessage("Share link removed");
    } catch (error: any) {
      setError(error.message || "Remove share failed");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopyShareLink = async (shareId: string) => {
    const url = makeShareUrl(shareId);
    await navigator.clipboard.writeText(url);
    setMessage("Copied link");
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!activeDrawingId) {
      return;
    }

    setIsBusy(true);
    setError("");
    setMessage("Restoring version...");

    try {
      const drawing = await restoreDrawingVersion(activeDrawingId, versionId);
      const data = normalizeDrawing(drawing);
      excalidrawAPI.addFiles(Object.values(data.files));
      excalidrawAPI.updateScene({
        elements: data.elements,
        appState: data.appState as any,
      });
      setActiveTitle(drawing.title);
      setActiveFolder(drawing.folder || "");
      setActiveTags(formatTags(drawing.tags));
      setActiveStarred(isDrawingStarred(drawing));
      lastSavedVersionRef.current = getSceneVersion(data.elements);
      await Promise.all([refreshDrawings(), refreshVersions(drawing.id)]);
      setMessage("Version restored");
    } catch (error: any) {
      setError(error.message || "Version restore failed");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className="CloudSync"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
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
              <div className="CloudSync__current">
                <input
                  id="cloud-title"
                  className="CloudSync__input CloudSync__input--title"
                  aria-label="Canvas name"
                  value={activeTitle}
                  onChange={(event) => setActiveTitle(event.target.value)}
                />
              </div>

              <div className="CloudSync__actions">
                <button
                  className="CloudSync__button CloudSync__button--primary"
                  type="button"
                  disabled={isBusy}
                  onClick={() => saveDrawing(false)}
                >
                  {activeDrawingId ? "Save" : "Save new"}
                </button>
                <button
                  className="CloudSync__button"
                  type="button"
                  disabled={isBusy}
                  onClick={() => saveDrawing(true)}
                >
                  Save as new
                </button>
                <button
                  className="CloudSync__button"
                  type="button"
                  disabled={isBusy}
                  onClick={handleNewCanvas}
                >
                  New canvas
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

              <details className="CloudSync__details">
                <summary>Canvas details</summary>
                <div className="CloudSync__metadataGrid">
                  <div>
                    <label className="CloudSync__label" htmlFor="cloud-folder">
                      Folder
                    </label>
                    <input
                      id="cloud-folder"
                      className="CloudSync__input"
                      placeholder="No folder"
                      value={activeFolder}
                      onChange={(event) => setActiveFolder(event.target.value)}
                    />
                  </div>
                  <label className="CloudSync__checkbox">
                    <input
                      type="checkbox"
                      checked={activeStarred}
                      onChange={(event) =>
                        setActiveStarred(event.target.checked)
                      }
                    />
                    Starred
                  </label>
                </div>
                <label className="CloudSync__label" htmlFor="cloud-tags">
                  Tags
                </label>
                <input
                  id="cloud-tags"
                  className="CloudSync__input"
                  placeholder="tag-one, tag-two"
                  value={activeTags}
                  onChange={(event) => setActiveTags(event.target.value)}
                />
              </details>

              {activeDrawingId && (
                <>
                  <details className="CloudSync__details">
                    <summary>Share links</summary>
                    <div className="CloudSync__inlineControls">
                      <select
                        className="CloudSync__select"
                        value={sharePermission}
                        onChange={(event) =>
                          setSharePermission(
                            event.target.value as CloudSharePermission,
                          )
                        }
                      >
                        <option value="view">View</option>
                        <option value="edit">Edit</option>
                      </select>
                      <button
                        className="CloudSync__button"
                        type="button"
                        disabled={isBusy}
                        onClick={handleCreateShareLink}
                      >
                        Create
                      </button>
                      <button
                        className="CloudSync__button"
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          refreshShareLinks().catch((error: Error) =>
                            setError(error.message),
                          )
                        }
                      >
                        Reload
                      </button>
                    </div>
                    <div className="CloudSync__miniList">
                      {!shareLinks.length && (
                        <div className="CloudSync__empty">No share links.</div>
                      )}
                      {shareLinks.map((share, index) => {
                        const shareId = getShareId(share);
                        const url = makeShareUrl(shareId);

                        return (
                          <div
                            className="CloudSync__miniRow"
                            key={shareId || index}
                          >
                            <div>
                              <div className="CloudSync__drawingTitle">
                                {url}
                              </div>
                              <div className="CloudSync__drawingMeta">
                                {share.permission}
                              </div>
                            </div>
                            <div className="CloudSync__actions">
                              <button
                                className="CloudSync__button"
                                type="button"
                                disabled={isBusy || !shareId}
                                onClick={() => handleCopyShareLink(shareId)}
                              >
                                Copy
                              </button>
                              <button
                                className="CloudSync__button"
                                type="button"
                                disabled={isBusy || !shareId}
                                onClick={() => handleDeleteShareLink(shareId)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>

                  <details className="CloudSync__details">
                    <summary>Versions</summary>
                    <div className="CloudSync__inlineControls">
                      <button
                        className="CloudSync__button"
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          refreshVersions().catch((error: Error) =>
                            setError(error.message),
                          )
                        }
                      >
                        Load versions
                      </button>
                    </div>
                    <div className="CloudSync__miniList">
                      {!versions.length && (
                        <div className="CloudSync__empty">
                          No versions loaded.
                        </div>
                      )}
                      {versions.map((version, index) => {
                        const versionId = getVersionId(version);

                        return (
                          <div
                            className="CloudSync__miniRow"
                            key={versionId || index}
                          >
                            <div>
                              <div className="CloudSync__drawingTitle">
                                {version.title || "Saved version"}
                              </div>
                              <div className="CloudSync__drawingMeta">
                                {new Date(version.created_at).toLocaleString()}
                              </div>
                            </div>
                            <button
                              className="CloudSync__button"
                              type="button"
                              disabled={isBusy || !versionId}
                              onClick={() => handleRestoreVersion(versionId)}
                            >
                              Restore
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </>
              )}

              <div className="CloudSync__sectionTitle">Saved canvases</div>
              <div className="CloudSync__filters">
                <div className="CloudSync__tabs">
                  {(["active", "starred", "trash"] as const).map((nextView) => (
                    <button
                      className={`CloudSync__tab ${
                        view === nextView ? "CloudSync__tab--active" : ""
                      }`}
                      key={nextView}
                      type="button"
                      onClick={() => setView(nextView)}
                    >
                      {nextView === "active"
                        ? "Active"
                        : nextView === "starred"
                        ? "Starred"
                        : "Trash"}
                    </button>
                  ))}
                </div>
                <input
                  className="CloudSync__input"
                  placeholder="Search title, folder, tags"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <div className="CloudSync__list">
                {!filteredDrawings.length && (
                  <div className="CloudSync__empty">
                    {drawings.length
                      ? "No canvases match this view."
                      : "Save this canvas to make it available in every browser."}
                  </div>
                )}
                {filteredDrawings.map((drawing) => {
                  const trashed = isDrawingTrashed(drawing);
                  const tags = drawing.tags || [];

                  return (
                    <div
                      className={`CloudSync__drawing ${
                        drawing.id === activeDrawingId
                          ? "CloudSync__drawing--active"
                          : ""
                      }`}
                      key={drawing.id}
                    >
                      <div>
                        <div className="CloudSync__drawingTitle">
                          {isDrawingStarred(drawing) ? "* " : ""}
                          {drawing.title}
                        </div>
                        <div className="CloudSync__drawingMeta">
                          {new Date(drawing.updated_at).toLocaleString()}
                        </div>
                        <div className="CloudSync__drawingTags">
                          {drawing.folder && <span>{drawing.folder}</span>}
                          {tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div className="CloudSync__actions">
                        {!trashed && (
                          <button
                            className="CloudSync__button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleOpen(drawing.id)}
                          >
                            Open
                          </button>
                        )}
                        {trashed ? (
                          <button
                            className="CloudSync__button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRestoreDrawing(drawing.id)}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            className="CloudSync__button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDelete(drawing.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
