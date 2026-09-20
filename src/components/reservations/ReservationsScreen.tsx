import { useState } from "react";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReservation,
  setDepositStatus,
  setReservationStatus,
} from "../../lib/functions/reservations.fn";
import type { DepositStatus, Reservation, ReservationStatus } from "../../lib/types/reservations";
import { reservationsBoardQuery } from "../../lib/queries/reservations";
import { ErrorBanner } from "../shared/ErrorBanner";
import { ScreenSkeletons } from "../shared/Skeletons";
import { ReservationCard } from "./ReservationCard";
import { ReservationKpis } from "./ReservationKpis";
import { ReservationSheet } from "./ReservationSheet";
import { CreateReservationSheet } from "./CreateReservationSheet";

export function ReservationsScreen() {
  const queryClient = useQueryClient();
  const query = useQuery(reservationsBoardQuery());
  const [selected, setSelected] = useState<Reservation | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["reservations-board"] });
  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: ReservationStatus }) =>
      setReservationStatus({ data: input }),
    onSuccess: invalidate,
  });
  const depositMutation = useMutation({
    mutationFn: (input: { id: string; status: DepositStatus }) => setDepositStatus({ data: input }),
    onSuccess: invalidate,
  });
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createReservation>[0]["data"]) =>
      createReservation({ data }),
    onSuccess: () => {
      setCreateOpen(false);
      invalidate();
    },
  });
  if (query.isPending) return <ScreenSkeletons />;
  if (query.isError && !query.data)
    return (
      <div className="px-4 pt-8">
        <ErrorBanner>Не удалось загрузить брони · попробуйте ещё раз</ErrorBanner>
        <button
          onClick={() => query.refetch()}
          className="mt-3 w-full rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white"
        >
          Повторить
        </button>
      </div>
    );
  const board = query.data;
  if (!board) return null;
  return (
    <div className="space-y-5 px-4 pt-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Гости и посадка
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Брони · {board.dateLabel}</h1>
      </header>
      {query.isError && <ErrorBanner>Нет связи с базой — показаны последние данные</ErrorBanner>}
      <ReservationKpis kpis={board.kpis} />
      <section>
        <h2 className="mb-3 font-semibold">Ближайшие гости</h2>
        {board.upcoming.length ? (
          <div className="space-y-3">
            {board.upcoming.map((reservation) => (
              <ReservationCard
                key={reservation.id}
                reservation={reservation}
                onClick={() => setSelected(reservation)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500">
            Сегодня броней нет
          </div>
        )}
      </section>
      <button
        onClick={() => setCreateOpen(true)}
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl"
      >
        <Plus />
      </button>
      {selected && (
        <ReservationSheet
          reservation={selected}
          onClose={() => setSelected(null)}
          onStatus={(status) => statusMutation.mutate({ id: selected.id, status })}
          onDeposit={(status) => depositMutation.mutate({ id: selected.id, status })}
        />
      )}
      {createOpen && (
        <CreateReservationSheet
          pending={createMutation.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(values) =>
            createMutation.mutate({ ...values, startsAt: new Date(values.startsAt).toISOString() })
          }
        />
      )}
    </div>
  );
}
