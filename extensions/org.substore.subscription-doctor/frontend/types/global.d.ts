/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>;
  export default component;
}

type MyAxiosRes = ErrorResponse | SucceedResponse;

interface ErrorResponse {
  status: 'failed';
  error: {
    code: string;
    type: string;
    message: string;
    details?: unknown;
  };
}

interface SucceedResponse {
  status: 'success';
  data?: any;
}
