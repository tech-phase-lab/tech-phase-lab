// The audit reads every company once, so the data cache is a pass-through.
export const unstable_cache = fn => (...args) => fn(...args);
export const revalidateTag = () => {};
