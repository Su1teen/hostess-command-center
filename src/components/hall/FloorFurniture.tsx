import type { FloorResource } from "../../lib/floor-operations";
import type { MapPosition } from "../../lib/hall/operations";

export function RoomFurniture({ gaming, title }: { gaming: boolean; title: string }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      <rect
        x="35"
        y="30"
        width="930"
        height="635"
        rx="36"
        fill="#f3eee5"
        stroke="#d9d0c0"
        strokeWidth="10"
      />
      <path d="M40 208H960M40 386H960M40 564H960" stroke="#e9e1d3" strokeWidth="2" />
      <path d="M180 34V660M440 34V660M700 34V660" stroke="#ede5d8" strokeWidth="2" />
      <rect
        x="95"
        y="57"
        width="240"
        height="54"
        rx="18"
        fill="#d9c5a4"
        stroke="#bca47e"
        strokeWidth="2"
      />
      <text x="215" y="90" textAnchor="middle" fill="#796449" fontSize="17" letterSpacing="3">
        {gaming ? "PLAYSTATION" : "БАР · XOXO"}
      </text>
      <text x="570" y="89" textAnchor="middle" fill="#998a76" fontSize="16" letterSpacing="2">
        {title.toUpperCase()}
      </text>
      <rect
        x="830"
        y="155"
        width="60"
        height="350"
        rx="22"
        fill="#c7cbb9"
        stroke="#a8b197"
        strokeWidth="2"
      />
      <path d="M842 176V484M833 268H884M833 382H884" stroke="#b2bba3" strokeWidth="3" />
      <text x="860" y="550" textAnchor="middle" fill="#889177" fontSize="13">
        ЛАУНЖ
      </text>
      {[
        { x: 82, y: 590 },
        { x: 910, y: 90 },
        { x: 912, y: 603 },
      ].map(({ x, y }) => (
        <g key={x + y} transform={`translate(${x} ${y})`}>
          <circle r="26" fill="#d6c7ac" />
          <ellipse cx="-9" cy="-5" rx="14" ry="23" transform="rotate(-40)" fill="#7b9779" />
          <ellipse cx="9" cy="-5" rx="13" ry="22" transform="rotate(40)" fill="#98ab87" />
          <ellipse cy="6" rx="11" ry="20" fill="#688b70" />
        </g>
      ))}
      <path d="M390 665H490" stroke="#f3eee5" strokeWidth="15" />
      <path d="M394 665V614Q440 614 440 663" fill="none" stroke="#b3a48d" strokeWidth="2" />
      <text x="535" y="643" fill="#9e927e" fontSize="13" letterSpacing="2">
        ВХОД
      </text>
    </g>
  );
}

export function TableFurniture({
  resource,
  position: p,
  gaming,
}: {
  resource: FloorResource;
  position: MapPosition;
  gaming: boolean;
}) {
  const seated = ["seated", "overdue"].includes(resource.state);
  const seats = Math.max(2, Math.min(8, resource.capacity ?? 4));
  const round = p.shape === "round";
  return (
    <g aria-hidden="true" pointerEvents="none">
      {Array.from({ length: seats }, (_, index) => {
        const side = Math.ceil(seats / 2);
        const upper = index < side;
        const count = upper ? side : seats - side;
        const angle = (2 * Math.PI * index) / seats - Math.PI / 2;
        const x = round
          ? p.width / 2 + Math.cos(angle) * (p.width / 2 + 14)
          : (((index % side) + 0.5) * p.width) / count;
        const y = round
          ? p.height / 2 + Math.sin(angle) * (p.height / 2 + 14)
          : upper
            ? -15
            : p.height + 15;
        return (
          <g key={index} transform={`translate(${x} ${y})`}>
            <rect
              x="-16"
              y="-11"
              width="32"
              height="22"
              rx={gaming ? 10 : 7}
              fill={gaming ? "#a6b59b" : "#cbbda7"}
              stroke={gaming ? "#849778" : "#b4a58e"}
              strokeWidth="2"
            />
            {seated &&
              index <
                (resource.currentSession?.guests ?? resource.projectedSession?.guests ?? 0) && (
                <circle r="8" fill="#987652" stroke="#f3e4cc" strokeWidth="2" />
              )}
          </g>
        );
      })}
      {gaming && (
        <g transform={`translate(${p.width / 2 - 28} -51)`}>
          <rect width="56" height="27" rx="4" fill="#3b4642" stroke="#657970" strokeWidth="3" />
          <path d="M8 19L24 6L34 19L48 8" fill="none" stroke="#90ac8b" strokeWidth="2" />
          <path d="M28 27V34M15 34H41" stroke="#6d766d" strokeWidth="3" />
        </g>
      )}
    </g>
  );
}
