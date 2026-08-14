import { request } from '@/extensions/frontend-sdk-v1';

const base = '/api/extensions/subscription-doctor';

export function useSubscriptionDoctorApi() {
  return {
    resources: () => request({ url: `${base}/resources`, method: 'get' }),
    reports: () => request({ url: `${base}/reports`, method: 'get' }),
    report: (id: string) => request({
      url: `${base}/report/${encodeURIComponent(id)}`,
      method: 'get',
    }),
    check: (sourceRef: ResourceRefV1) => request({
      url: `${base}/check`,
      method: 'post',
      data: { sourceRef },
    }),
    remove: (id: string) => request({
      url: `${base}/report/${encodeURIComponent(id)}`,
      method: 'delete',
    }),
    exportUrl: (id: string, format: 'json' | 'markdown') => (
      `${base}/report/${encodeURIComponent(id)}/export/${format}`
    ),
    exportText: (id: string, format: 'json' | 'markdown') => request({
      url: `${base}/report/${encodeURIComponent(id)}/export/${format}`,
      method: 'get',
      responseType: 'text',
    }),
  };
}

