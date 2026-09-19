import { EditorRoute } from './EditorRoute';

export const dynamic = 'force-dynamic';

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <EditorRoute projectId={projectId} />;
}