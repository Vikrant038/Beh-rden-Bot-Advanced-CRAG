"use client";

import { motion } from "framer-motion";

export function DisambiguationCards({
  options,
  onSelect,
}: {
  options: string[];
  onSelect: (option: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option, index) => (
        <motion.button
          key={option}
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08 }}
          whileHover={{ scale: 1.02 }}
          onClick={() => onSelect(option)}
          className="rounded-xl border border-glass-border bg-glass px-4 py-3 text-left text-sm backdrop-blur transition-colors hover:border-primary hover:text-primary"
        >
          {option}
        </motion.button>
      ))}
    </div>
  );
}
