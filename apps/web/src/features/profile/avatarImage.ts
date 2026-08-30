/** Lado do avatar em pixels apos o redimensionamento. */
const AVATAR_SIZE = 128;
const JPEG_QUALITY = 0.82;
/** Teto aceito pelo log replicado, com folga sobre o limite do core. */
const MAX_DATA_URL = 46_000;

/**
 * Reduz a imagem escolhida a um quadrado de 128px e devolve um data URL.
 *
 * O redimensionamento acontece antes de qualquer coisa porque o avatar viaja
 * dentro de uma operacao assinada e replicada: uma foto de 4 MB ficaria para
 * sempre no log de todos os peers. Cortar no centro evita distorcer o rosto.
 */
export async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Nao foi possivel processar a imagem');

    // Recorte central: pega o maior quadrado que cabe na imagem original.
    const lado = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - lado) / 2;
    const sy = (bitmap.height - lado) / 2;

    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, sx, sy, lado, lado, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

    // Fotos com muito detalhe podem passar do teto mesmo em 128px; baixa a
    // qualidade em vez de recusar o arquivo.
    for (let qualidade = 0.7; dataUrl.length > MAX_DATA_URL && qualidade >= 0.4; qualidade -= 0.15) {
      dataUrl = canvas.toDataURL('image/jpeg', qualidade);
    }

    if (dataUrl.length > MAX_DATA_URL) {
      throw new Error('Nao foi possivel comprimir esta imagem o suficiente');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
