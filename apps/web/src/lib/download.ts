const save = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-z0-9._-]+/gi, '-');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadJson = (filename: string, data: unknown) =>
  save(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));

export const downloadText = (filename: string, text: string) => save(filename, new Blob([text], { type: 'text/plain' }));
