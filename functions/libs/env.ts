// env-mock.ts : this is the mock for accessing environment that cannot access from SDK
const mockEnv = {
  get: (key: string): string | undefined => {
    if (key === "DEBUG") {
      return "false";
    }
    return undefined;
  },

  has: (key: string): boolean => {
    return key === "DEBUG";
  },

  set: (_key: string, _value: string): void => {
    // no-op
  },

  delete: (_key: string): void => {
    // no-op
  },

  toObject: (): Record<string, string> => {
    return { DEBUG: "" };
  },
};

Object.defineProperty(Deno, "env", {
  value: mockEnv,
  writable: false,
  configurable: false,
});

export {};
