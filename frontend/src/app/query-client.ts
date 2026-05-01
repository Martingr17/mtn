import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error) => {
        const message =
          error instanceof Error ? error.message : "Операция не выполнена. Попробуйте ещё раз.";
        toast.error(message);
      },
    },
  },
});
