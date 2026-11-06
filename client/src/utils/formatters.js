export const formatBytes = (bytes, decimals = 1) => {
  const numericBytes = Number(bytes);
  if (!numericBytes || isNaN(numericBytes) || numericBytes <= 0) {
    return '0 B';
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(numericBytes) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);

  return `${parseFloat((numericBytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
};

