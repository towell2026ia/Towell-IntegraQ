import {
  GENERAL_INFORMATION_MAX_BATCH_FILES,
  validateGeneralInformationFile,
  validateGeneralInformationMetadata,
  type GeneralInformationDocumentInput,
} from "@/lib/general-information";
import {
  createGeneralInformationFolder,
  fetchGeneralInformation,
  getGeneralInformationFileUrl,
  patchGeneralInformation,
  uploadGeneralInformation,
} from "@/lib/repositories/general-information-repository";

export { fetchGeneralInformation, getGeneralInformationFileUrl, patchGeneralInformation };

export async function addGeneralInformationFolder(input: {
  name: string;
  description?: string;
  parentFolderId?: string;
}) {
  if (!input.name.trim()) throw new Error("El nombre de la carpeta es obligatorio.");
  return createGeneralInformationFolder({ ...input, name: input.name.trim() });
}

export async function addGeneralInformationDocuments(
  files: File[],
  metadata: GeneralInformationDocumentInput[],
  onProgress?: (percent: number) => void,
  replaceDocumentId?: string,
) {
  if (!files.length || files.length > GENERAL_INFORMATION_MAX_BATCH_FILES || files.length !== metadata.length) {
    throw new Error(`Selecciona entre 1 y ${GENERAL_INFORMATION_MAX_BATCH_FILES} archivos con metadata completa.`);
  }
  for (let index = 0; index < files.length; index += 1) {
    const fileError = validateGeneralInformationFile(files[index]);
    if (fileError) throw new Error(`${files[index].name}: ${fileError}`);
    const metadataError = validateGeneralInformationMetadata(metadata[index]);
    if (metadataError) throw new Error(`${files[index].name}: ${metadataError}`);
  }
  return uploadGeneralInformation(files, metadata, onProgress, replaceDocumentId);
}
