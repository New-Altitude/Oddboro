export function formatMemory(n: number) {
  return n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GiB' : Math.round(n / 1024 ** 2) + ' MiB';
}
