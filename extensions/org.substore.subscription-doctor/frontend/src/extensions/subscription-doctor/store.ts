import { defineStore } from '@/extensions/frontend-sdk-v1';
import { useSubscriptionDoctorApi } from './api';

const api = useSubscriptionDoctorApi();

const isRecord = (value: unknown): value is Record<string, any> => Boolean(value)
  && typeof value === 'object';

const unwrap = <T>(response: any, fallback: T): T => {
  const envelope = response?.data;
  if (envelope?.status === 'failed') {
    const error = new Error(envelope.error?.message || 'SUBSCRIPTION_DOCTOR_REQUEST_FAILED');
    (error as any).code = envelope.error?.code;
    throw error;
  }
  const value = envelope?.status === 'success' ? envelope.data : envelope;
  return (value ?? fallback) as T;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && isRecord(error.response)) {
    return error.response.data?.error?.message || 'SUBSCRIPTION_DOCTOR_REQUEST_FAILED';
  }
  return 'SUBSCRIPTION_DOCTOR_REQUEST_FAILED';
};

export const useSubscriptionDoctorStore = defineStore('subscriptionDoctor', {
  state: () => ({
    resources: [] as SubscriptionDoctorResource[],
    reports: [] as SubscriptionDoctorReport[],
    loading: false,
    checking: false,
    error: '',
  }),
  actions: {
    async refresh() {
      this.loading = true;
      this.error = '';
      try {
        const [resourceResponse, reportResponse] = await Promise.all([
          api.resources(),
          api.reports(),
        ]);
        const resourceData = unwrap<any>(resourceResponse, { resources: [] });
        const reportData = unwrap<any>(reportResponse, { reports: [] });
        this.resources = Array.isArray(resourceData)
          ? resourceData
          : resourceData.resources || [];
        this.reports = Array.isArray(reportData)
          ? reportData
          : reportData.reports || [];
        return true;
      } catch (error) {
        this.error = errorMessage(error);
        return false;
      } finally {
        this.loading = false;
      }
    },
    async run(sourceRef: ResourceRefV1) {
      this.checking = true;
      this.error = '';
      try {
        const report = unwrap<SubscriptionDoctorReport | null>(
          await api.check(sourceRef),
          null,
        );
        if (!report) throw new Error('SUBSCRIPTION_DOCTOR_EMPTY_REPORT');
        this.reports = [report, ...this.reports.filter(item => item.id !== report.id)]
          .slice(0, 20);
        return report;
      } catch (error) {
        this.error = errorMessage(error);
        return null;
      } finally {
        this.checking = false;
      }
    },
    async getReport(id: string) {
      const cached = this.reports.find(report => report.id === id);
      if (cached) return cached;
      try {
        return unwrap<SubscriptionDoctorReport | null>(await api.report(id), null);
      } catch (error) {
        this.error = errorMessage(error);
        return null;
      }
    },
    async remove(id: string) {
      try {
        unwrap(await api.remove(id), null);
        this.reports = this.reports.filter(report => report.id !== id);
        return true;
      } catch (error) {
        this.error = errorMessage(error);
        return false;
      }
    },
    async exportText(id: string, format: 'json' | 'markdown') {
      try {
        const response = await api.exportText(id, format);
        return typeof response?.data === 'string'
          ? response.data
          : JSON.stringify(response?.data ?? '', null, 2);
      } catch (error) {
        this.error = errorMessage(error);
        return '';
      }
    },
  },
});

