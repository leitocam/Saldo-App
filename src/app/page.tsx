import { FinanceProvider } from "@/components/finance-provider";
import { FinanceApp } from "@/components/finance-app";
export default function Page() {
  return (
    <FinanceProvider>
      <FinanceApp />
    </FinanceProvider>
  );
}
