import { permanentRedirect } from "next/navigation";

export default function PatchArchivePage() {
  permanentRedirect("/patches#archive");
}
