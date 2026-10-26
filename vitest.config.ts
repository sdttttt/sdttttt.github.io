import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/__tests__/**/*.test.ts'],
    // 测试里用 process.chdir() 切到临时目录（scripts/__tests__/temp-dir.ts），
    // 而 worker_threads 里 chdir 会抛 ERR_WORKER_UNSUPPORTED_OPERATION ——
    // 所以必须跑在子进程里。forks 也是 vitest 的默认值，这里写明是为了别被改掉。
    pool: 'forks',
  },
});
