import type {
  ArtifactExportFormat,
  ProductivityArtifact,
  ProductivityArtifactKind,
  ProductivityArtifactSummary,
} from "../types";

export type ArtifactCollectionApi = {
  readArtifact(id: string): Promise<ProductivityArtifact>;
  saveArtifact(
    artifact: ProductivityArtifact,
  ): Promise<ProductivityArtifactSummary>;
  deleteArtifact(id: string): Promise<boolean>;
  exportArtifact(
    artifact: ProductivityArtifact,
    format: ArtifactExportFormat,
  ): Promise<string>;
};

export const preferredArtifactExportFormat: Record<
  ProductivityArtifactKind,
  ArtifactExportFormat
> = {
  document: "docx",
  spreadsheet: "xlsx",
  presentation: "pptx",
};

async function currentArtifact(
  api: ArtifactCollectionApi,
  artifact: ProductivityArtifactSummary,
  active: ProductivityArtifact | null,
) {
  return active?.id === artifact.id
    ? active
    : await api.readArtifact(artifact.id);
}

export async function patchProductivityArtifact(
  api: ArtifactCollectionApi,
  artifact: ProductivityArtifactSummary,
  active: ProductivityArtifact | null,
  patch: { title?: string; folder?: string; favorite?: boolean },
) {
  const source = await currentArtifact(api, artifact, active);
  return api.saveArtifact({ ...source, ...patch });
}

export async function duplicateProductivityArtifact(
  api: ArtifactCollectionApi,
  artifact: ProductivityArtifactSummary,
  active: ProductivityArtifact | null,
  id: string,
  timestamp: string,
) {
  const source = await currentArtifact(api, artifact, active);
  const copy: ProductivityArtifact = {
    ...source,
    id,
    title: `${source.title} copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return api.saveArtifact(copy);
}

export async function exportProductivityArtifact(
  api: ArtifactCollectionApi,
  artifact: ProductivityArtifactSummary,
  active: ProductivityArtifact | null,
) {
  const source = await currentArtifact(api, artifact, active);
  return api.exportArtifact(
    source,
    preferredArtifactExportFormat[artifact.kind],
  );
}

export function deleteProductivityArtifact(
  api: ArtifactCollectionApi,
  artifact: ProductivityArtifactSummary,
) {
  return api.deleteArtifact(artifact.id);
}
