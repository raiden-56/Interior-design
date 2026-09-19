'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createProject } from '@interior/core';
import { getProjectLocal, remoteGet, saveProjectLocal } from '@/lib/storage';
import { useEditorStore } from '@/stores/editor-store';
import { EditorShell } from '@/components/editor/EditorShell';

type Status = 'loading' | 'ready' | 'missing';

/**
 * Resolves `/editor/<id>`: this browser's copy first, then the backend (so a
 * link shared from another device opens the real project), and only then a
 * "not found" screen. The previous version silently created an empty project
 * named "Shared Studio Project" for any unknown id.
 */
export function EditorRoute({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>('loading');

  React.useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const store = useEditorStore.getState();

    const local = getProjectLocal(projectId);
    if (local) {
      store.loadProject(local);
      setStatus('ready');
      // Pull a newer copy from the backend if another device saved since.
      void remoteGet(projectId).then((remote) => {
        if (cancelled || !remote || remote.updatedAt <= local.updatedAt) return;
        if (useEditorStore.getState().dirty) return; // don't clobber edits in progress
        saveProjectLocal(remote);
        useEditorStore.getState().loadProject(remote);
      });
      return () => {
        cancelled = true;
      };
    }

    void remoteGet(projectId).then((remote) => {
      if (cancelled) return;
      if (remote) {
        saveProjectLocal(remote);
        useEditorStore.getState().loadProject(remote);
        setStatus('ready');
      } else {
        setStatus('missing');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const createHere = () => {
    const p = { ...createProject('New Project'), id: projectId, updatedAt: Date.now() };
    saveProjectLocal(p);
    useEditorStore.getState().loadProject(p);
    void useEditorStore.getState().saveNow();
    setStatus('ready');
    router.replace(`/editor/${projectId}`);
  };

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#090b10] text-sm text-zinc-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-sky-500" />
          Opening project…
        </div>
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#090b10] px-6 text-center text-sm text-zinc-400">
        <p className="text-base font-medium text-zinc-100">This project could not be found</p>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          It may have been deleted, or it was saved in a different browser while the backend was offline. Ask the sender to open
          it once with the backend running so it syncs, or import their exported JSON file.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/" className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
            Back to projects
          </Link>
          <button onClick={createHere} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500">
            Start a new project at this link
          </button>
        </div>
      </div>
    );
  }

  return <EditorShell />;
}
