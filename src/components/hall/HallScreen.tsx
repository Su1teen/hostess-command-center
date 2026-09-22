import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReservation,
  setDepositStatus,
  setReservationStatus,
} from "../../lib/functions/reservations.fn";
import {
  addMinutesIso,
  almatyDateKey,
  almatyTimeKey,
  almatyToIso,
} from "../../lib/formatters/time";
import { DEFAULT_RESERVATION_MINUTES } from "../../lib/hall/layout";
import {
  RESERVATIONS_KEY,
  reservationsBoardQuery,
  tableAvailabilityQuery,
} from "../../lib/queries/reservations";
import {
  TABLE_OCCUPANCY_LABEL,
  type DepositStatus,
  type Reservation,
  type ReservationStatus,
  type TableOccupancy,
} from "../../lib/types/reservations";
import {
  CreateReservationSheet,
  type CreateReservationValues,
} from "../reservations/CreateReservationSheet";
import { ReservationSheet } from "../reservations/ReservationSheet";
import { roundTimeUp } from "../shared/DateTimeWheel";
import { DateTimeSelector } from "./DateTimeSelector";
import { FloorPlan, OCCUPANCY_COLOR } from "./FloorPlan";
import { ReservationsPanel } from "./ReservationsPanel";
import { TableSheet } from "./TableSheet";

const LEGEND: TableOccupancy[] = ["free", "booked", "seated"];

function defaultTime(): string {
  const now = almatyTimeKey();
  if (now >= "23:30") return "23:30";
  const rounded = roundTimeUp(now, 30);
  return rounded < "12:00" ? "18:00" : rounded;
}

export function HallScreen({ openReservations = false }: { openReservations?: boolean }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => almatyDateKey());
  const [time, setTime] = useState(defaultTime);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [panelOpen, setPanelOpen] = useState(openReservations);
  const [create, setCreate] = useState<{ tableId: string | null } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (openReservations) setPanelOpen(true);
  }, [openReservations]);

  const startsAt = useMemo(() => almatyToIso(date, time), [date, time]);
  const endsAt = useMemo(() => addMinutesIso(startsAt, DEFAULT_RESERVATION_MINUTES), [startsAt]);

  const availability = useQuery(tableAvailabilityQuery(startsAt, endsAt));
  const board = useQuery(reservationsBoardQuery(date));

  const occupancy = useMemo(() => {
    const map = new Map<string, TableOccupancy>();
    availability.data?.tables.forEach((entry) => map.set(entry.tableId, entry.status));
    return map;
  }, [availability.data]);
  const entryFor = (tableId: string) =>
    availability.data?.tables.find((entry) => entry.tableId === tableId);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: RESERVATIONS_KEY });

  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: ReservationStatus }) =>
      setReservationStatus({ data: input }),
    onSuccess: (updated) => {
      setSelectedReservation(updated);
      invalidate();
    },
  });
  const depositMutation = useMutation({
    mutationFn: (input: { id: string; status: DepositStatus }) => setDepositStatus({ data: input }),
    onSuccess: (updated) => {
      setSelectedReservation(updated);
      invalidate();
    },
  });
  const createMutation = useMutation({
    mutationFn: (values: CreateReservationValues) => createReservation({ data: values }),
    onSuccess: (result) => {
      if (!result.ok) {
        setCreateError(result.message);
        return;
      }
      setCreate(null);
      setCreateError(null);
      setSelectedTable(null);
      setPanelOpen(true);
      invalidate();
    },
    onError: (error) => setCreateError(error.message),
  });

  return (
    <div className="space-y-4 px-4 pb-52 pt-6">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <MapPin size={13} /> Основной зал
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Зал</h1>
      </header>

      <DateTimeSelector date={date} time={time} onDate={setDate} onTime={setTime} />

      <FloorPlan
        occupancy={occupancy}
        selectedId={selectedTable}
        onSelect={setSelectedTable}
        stale={availability.isFetching && availability.isPlaceholderData}
      />
      <p className="-mt-2 px-1 text-center text-[11px] text-slate-400">
        Нажмите на стол, чтобы выбрать · двумя пальцами можно перемещать и масштабировать карту
      </p>

      <div className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
        {LEGEND.map((status) => (
          <div key={status} className="rounded-2xl bg-white p-3">
            <span
              className="mx-auto mb-1 block h-3 w-3 rounded-full"
              style={{ background: OCCUPANCY_COLOR[status] }}
            />
            {TABLE_OCCUPANCY_LABEL[status]}
          </div>
        ))}
      </div>

      <ReservationsPanel
        board={board.data}
        open={panelOpen}
        onToggle={setPanelOpen}
        onCreate={() => {
          setCreateError(null);
          setCreate({ tableId: null });
        }}
        onOpen={setSelectedReservation}
        stale={board.isFetching && board.isPlaceholderData}
      />

      {selectedTable && !create && !selectedReservation && (
        <TableSheet
          tableId={selectedTable}
          entry={entryFor(selectedTable)}
          timeLabel={time}
          dayReservations={board.data?.upcoming ?? []}
          onClose={() => setSelectedTable(null)}
          onBook={() => {
            setCreateError(null);
            setCreate({ tableId: selectedTable });
          }}
          onOpenReservation={setSelectedReservation}
        />
      )}

      {selectedReservation && (
        <ReservationSheet
          reservation={selectedReservation}
          onClose={() => setSelectedReservation(null)}
          onStatus={(status) => statusMutation.mutate({ id: selectedReservation.id, status })}
          onDeposit={(status) => depositMutation.mutate({ id: selectedReservation.id, status })}
        />
      )}

      {create && (
        <CreateReservationSheet
          initialDate={date}
          initialTime={time}
          initialTableId={create.tableId}
          pending={createMutation.isPending}
          serverError={createError}
          onClose={() => setCreate(null)}
          onSubmit={(values) => {
            setCreateError(null);
            createMutation.mutate(values);
          }}
        />
      )}
    </div>
  );
}
