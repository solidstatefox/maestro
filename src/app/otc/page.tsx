import { redirect } from "next/navigation";

/** OTC now runs inside Maestro chat. Legacy standalone entry redirects to Results. */
export default function OtcRedirectPage() {
  redirect("/");
}
