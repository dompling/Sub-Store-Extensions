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

interface Process {
  type: string;
  id?: string;
  customName?: string;
  args?: any;
  disabled?: boolean;
}

type ActionModuleProps = {
  id: string;
  customName: string;
  type: string;
  component: any;
  tipsDes: string;
  disabled?: boolean;
  enabled?: boolean;
  nameEditable?: boolean;
};

type EditorGroupingMode = 'edit-only' | 'disabled' | 'always';
