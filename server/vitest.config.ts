import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These are integration tests doing real bcrypt hashing; under parallel
    // workers on a loaded machine they can exceed the 5s default.
    testTimeout: 30000,
  },
});
