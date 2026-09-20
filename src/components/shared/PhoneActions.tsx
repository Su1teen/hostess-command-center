import { MessageCircle, Phone } from "lucide-react";

export function PhoneActions({ phone }: { phone: string }) {
  const digits = phone.replace(/\D/g, "");
  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={`tel:${phone}`}
        className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-medium"
      >
        <Phone size={16} /> Позвонить
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-medium"
      >
        <MessageCircle size={16} /> WhatsApp
      </a>
    </div>
  );
}
