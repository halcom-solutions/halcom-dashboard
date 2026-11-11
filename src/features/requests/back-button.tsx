"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Goes back to the page the person came from (the board, a list, the project). When the page was opened on its own (a link from an email in a
 * new tab, so there is nothing to go back to) it goes to `fallback`, the list of requests.
 */
export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  // The Navigation API knows whether there is an earlier entry; older browsers fall back to the length of the history.
  const canGoBack = () => {
    const navigation = (window as unknown as { navigation?: { canGoBack: boolean } }).navigation;
    return navigation ? navigation.canGoBack : window.history.length > 1;
  };
  return (
    <Button type="button" variant="outline" className="self-start" onClick={() => (canGoBack() ? router.back() : router.push(fallback))}>
      <ArrowLeft aria-hidden data-icon="inline-start" />
      Kembali
    </Button>
  );
}
