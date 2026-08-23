import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

export function useTrace(id: string) {
  const { tracesAPI } = useAPIClient();
  return useQuery({
    queryKey: ['trace', id],
    queryFn: () => tracesAPI.getTrace(id),
    enabled: !!id,
  });
}
