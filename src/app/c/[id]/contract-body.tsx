import { parseContractMarkdown, type ContractInline } from "@/lib/contracts/markdown";

const Inlines = ({ inlines }: { inlines: ContractInline[] }) => (
  <>
    {inlines.map((inline, i) =>
      inline.bold ? (
        <strong key={i}>{inline.text}</strong>
      ) : inline.italic ? (
        <em key={i}>{inline.text}</em>
      ) : (
        <span key={i}>{inline.text}</span>
      ),
    )}
  </>
);

export const ContractBody = ({ markdown }: { markdown: string }) => {
  const blocks = parseContractMarkdown(markdown);

  return (
    <div className="flex flex-col gap-3 text-sm text-text-secondary">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h2 key={i} className="mt-2 text-lg font-semibold text-foreground">
                <Inlines inlines={block.inlines} />
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3 key={i} className="mt-2 text-base font-semibold text-foreground">
                <Inlines inlines={block.inlines} />
              </h3>
            );
          }
          return (
            <h4 key={i} className="mt-1 text-sm font-semibold text-foreground">
              <Inlines inlines={block.inlines} />
            </h4>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={i}>
              <Inlines inlines={block.inlines} />
            </p>
          );
        }
        if (block.type === "blockquote") {
          return (
            <blockquote key={i} className="border-l-2 border-border pl-3 italic">
              <Inlines inlines={block.inlines} />
            </blockquote>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={i} className="list-disc pl-5">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "table") {
          return (
            <table key={i} className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {block.header.map((cell, j) => (
                    <th key={j} className="border border-border bg-surface-hover p-2 text-left font-semibold">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="border border-border p-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return <hr key={i} className="border-border" />;
      })}
    </div>
  );
};
