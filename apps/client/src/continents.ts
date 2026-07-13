/** Swatch colours identifying each continent in the Continents panel. Both the
 * World and Classic boards use these same six continent ids. */
export const CONTINENT_COLORS: Record<string, string> = {
  "north-america": "#e6a817",
  "south-america": "#2ec4b6",
  europe: "#6ea8ff",
  africa: "#f4795b",
  asia: "#b57edc",
  oceania: "#7bd389",
};

/** On-globe highlight when a continent is selected. */
export const HAVE_COLOR = "#22c55e"; // territories you already hold
export const NEED_COLOR = "#ffcc33"; // territories you still need to complete it
