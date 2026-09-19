import { type DiagramMap } from "./schema";

// Demo simulation: source labels and proposals are authored fixtures, not OCR/model results.
const definitions = [
  {
    id: "heart",
    title: "A journey through the heart",
    subject: "Biology",
    flow: "Blood through the pulmonary circuit",
    names: [
      "Right ventricle",
      "Pulmonary artery",
      "Lungs",
      "Pulmonary veins",
      "Left atrium",
    ],
    descriptions: [
      "Pumps blood toward the lungs through the pulmonary artery.",
      "Carries blood from the right ventricle toward the lungs.",
      "The site where oxygen enters the blood and carbon dioxide leaves it.",
      "Return blood from the lungs to the left atrium.",
      "Receives blood returning from the lungs.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "water",
    title: "Following the water cycle",
    subject: "Earth science",
    flow: "A simplified water cycle",
    names: ["Collection", "Evaporation", "Condensation", "Precipitation"],
    descriptions: [
      "Water gathers in lakes, rivers and other reservoirs.",
      "Liquid water changes into water vapor.",
      "Water vapor cools and forms liquid droplets.",
      "Water falls from clouds to the surface.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "plant",
    title: "Water through a plant",
    subject: "Biology",
    flow: "A simplified water pathway",
    names: ["Roots", "Stem", "Leaves"],
    descriptions: [
      "Absorb water from the soil.",
      "Contains tissues that transport water toward the leaves.",
      "Release water vapor through small openings called stomata.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "circuit",
    title: "A simple circuit",
    subject: "Physics",
    flow: "Reading the connected components",
    names: ["Battery", "Switch", "Lamp"],
    descriptions: [
      "Provides the potential difference for the circuit.",
      "Opens or closes the conducting path.",
      "Converts electrical energy into light and heat.",
    ],
    relation: "connects_to" as const,
  },
  {
    id: "pump",
    title: "Moving water",
    subject: "Engineering",
    flow: "Water path",
    names: ["Tank A", "Pump", "Tank B"],
    descriptions: [
      "Holds the starting supply of water.",
      "Moves water from Tank A toward Tank B.",
      "Receives the water moved by the pump.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "solar",
    title: "Around the solar system",
    subject: "Space",
    flow: "Planets in order from the Sun",
    names: ["Sun", "Mercury", "Earth", "Jupiter", "Neptune"],
    descriptions: [
      "The star at the centre; its gravity holds every planet in orbit.",
      "The smallest planet and the closest to the Sun.",
      "Our home planet, the only one known to support life.",
      "The largest planet; a gas giant with many moons.",
      "The farthest planet, an ice giant with the strongest winds.",
    ],
    relation: "connects_to" as const,
  },
  {
    id: "atom",
    title: "Inside a carbon atom",
    subject: "Chemistry",
    flow: "Reading the atom from the centre out",
    names: ["Nucleus", "Proton", "Neutron", "Electron", "Electron shell"],
    descriptions: [
      "The dense centre of the atom where most of its mass sits.",
      "A positive particle in the nucleus; carbon has six of them.",
      "A neutral particle in the nucleus that adds mass without charge.",
      "A negative particle orbiting the nucleus in shells.",
      "The energy level that holds the orbiting electrons.",
    ],
    relation: "connects_to" as const,
  },
  {
    id: "ev",
    title: "How an electric vehicle moves",
    subject: "EV technology",
    flow: "Energy from battery to wheels",
    names: ["Battery pack", "Inverter", "Motor", "Gearbox", "Wheels"],
    descriptions: [
      "Stores the electrical energy that powers the vehicle.",
      "Converts the battery's direct current into alternating current.",
      "Turns electrical energy into the rotation that drives the car.",
      "Transfers the motor's rotation with the right torque.",
      "Push against the road to move the vehicle forward.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "states",
    title: "Changing states of matter",
    subject: "Physics",
    flow: "Water changing state as energy moves",
    names: ["Ice", "Melting", "Liquid water", "Boiling", "Water vapour"],
    descriptions: [
      "The solid state, where particles are locked in a fixed lattice.",
      "The change from solid to liquid as heat energy is added.",
      "The liquid state, where particles slide past one another.",
      "The change from liquid to gas, first at the surface, then throughout.",
      "The gas state, where particles move freely and spread out.",
    ],
    relation: "flows_to" as const,
  },
  {
    id: "food",
    title: "Following food through the body",
    subject: "Biology",
    flow: "The journey of a meal",
    names: ["Mouth", "Oesophagus", "Stomach", "Small intestine", "Large intestine"],
    descriptions: [
      "Chews food and mixes it with saliva to begin digestion.",
      "Pushes the swallowed food down to the stomach.",
      "Churns food with acid and enzymes into a thick liquid.",
      "Absorbs most of the nutrients into the bloodstream.",
      "Absorbs water and forms the remaining waste.",
    ],
    relation: "flows_to" as const,
  },
];
export { fixtures } from "./catalog";
// Ground truth for evaluation runs (see server/evaluation-runs.ts). Self-created schematics.
export const groundTruth = [
  {
    fixtureId: "heart",
    expectedLabels: ["Right ventricle", "Pulmonary artery", "Lungs", "Pulmonary veins", "Left atrium"],
    expectedRelations: [
      "Right ventricle -> Pulmonary artery",
      "Pulmonary artery -> Lungs",
      "Lungs -> Pulmonary veins",
      "Pulmonary veins -> Left atrium",
    ],
    expectedFlow: ["Right ventricle", "Pulmonary artery", "Lungs", "Pulmonary veins", "Left atrium"],
  },
  {
    fixtureId: "water",
    expectedLabels: ["Collection", "Evaporation", "Condensation", "Precipitation"],
    expectedRelations: [
      "Collection -> Evaporation",
      "Evaporation -> Condensation",
      "Condensation -> Precipitation",
    ],
    expectedFlow: ["Collection", "Evaporation", "Condensation", "Precipitation"],
  },
  {
    fixtureId: "plant",
    expectedLabels: ["Roots", "Stem", "Leaves"],
    expectedRelations: ["Roots -> Stem", "Stem -> Leaves"],
    expectedFlow: ["Roots", "Stem", "Leaves"],
  },
  {
    fixtureId: "circuit",
    expectedLabels: ["Battery", "Switch", "Lamp"],
    expectedRelations: ["Battery - Switch", "Switch - Lamp"],
    expectedFlow: ["Battery", "Switch", "Lamp"],
  },
  {
    fixtureId: "pump",
    expectedLabels: ["Tank A", "Pump", "Tank B"],
    expectedRelations: ["Tank A -> Pump", "Pump -> Tank B"],
    expectedFlow: ["Tank A", "Pump", "Tank B"],
  },
  {
    fixtureId: "solar",
    expectedLabels: ["Sun", "Mercury", "Earth", "Jupiter", "Neptune"],
    expectedRelations: [
      "Sun - Mercury",
      "Mercury - Earth",
      "Earth - Jupiter",
      "Jupiter - Neptune",
    ],
    expectedFlow: ["Sun", "Mercury", "Earth", "Jupiter", "Neptune"],
  },
  {
    fixtureId: "atom",
    expectedLabels: ["Nucleus", "Proton", "Neutron", "Electron", "Electron shell"],
    expectedRelations: [
      "Nucleus - Proton",
      "Proton - Neutron",
      "Neutron - Electron",
      "Electron - Electron shell",
    ],
    expectedFlow: ["Nucleus", "Proton", "Neutron", "Electron", "Electron shell"],
  },
  {
    fixtureId: "ev",
    expectedLabels: ["Battery pack", "Inverter", "Motor", "Gearbox", "Wheels"],
    expectedRelations: [
      "Battery pack -> Inverter",
      "Inverter -> Motor",
      "Motor -> Gearbox",
      "Gearbox -> Wheels",
    ],
    expectedFlow: ["Battery pack", "Inverter", "Motor", "Gearbox", "Wheels"],
  },
  {
    fixtureId: "states",
    expectedLabels: ["Ice", "Melting", "Liquid water", "Boiling", "Water vapour"],
    expectedRelations: [
      "Ice -> Melting",
      "Melting -> Liquid water",
      "Liquid water -> Boiling",
      "Boiling -> Water vapour",
    ],
    expectedFlow: ["Ice", "Melting", "Liquid water", "Boiling", "Water vapour"],
  },
  {
    fixtureId: "food",
    expectedLabels: ["Mouth", "Oesophagus", "Stomach", "Small intestine", "Large intestine"],
    expectedRelations: [
      "Mouth -> Oesophagus",
      "Oesophagus -> Stomach",
      "Stomach -> Small intestine",
      "Small intestine -> Large intestine",
    ],
    expectedFlow: ["Mouth", "Oesophagus", "Stomach", "Small intestine", "Large intestine"],
  },
] as const;
export function fixtureMap(fixtureId: string, injectReview = true): DiagramMap {
  const f = definitions.find((f) => f.id === fixtureId);
  if (!f) throw new Error("Unknown fixture.");
  const labels = f.names.map((name, i) => ({
    id: `label-${i}`,
    text: name,
    confidence: null,
    source: "demo_fixture" as const,
    x: 0.5,
    y: 0.16 + i * (0.68 / (f.names.length - 1)),
  }));
  const parts = f.names.map((name, i) => ({
    id: `part-${i}`,
    name,
    labelId: labels[i].id,
    description: f.descriptions[i],
    aliases:
      f.id === "heart" && name === "Pulmonary artery" ? ["Pulmonary trunk"] : [],
    modelConfidence: null,
    state: "ai_proposed" as const,
    reviewNote: "",
  }));
  const relations = parts
    .slice(0, -1)
    .map((part, i) => ({
      id: `relation-${i}`,
      from: part.id,
      to: parts[i + 1].id,
      kind: f.relation,
      evidence: injectReview && i === 1 ? [] : [labels[i].id, labels[i + 1].id],
      modelConfidence: null,
      state: "ai_proposed" as const,
      reviewNote: "",
    }));
  return {
    labels,
    parts,
    relations,
    flows: [
      {
        id: "flow-0",
        name: f.flow,
        steps: parts.map((p) => p.id),
        state: "ai_proposed",
        reviewNote: "",
      },
    ],
  };
}
export const demoTranscript =
  "Today we are following blood from the Right ventricle to the Pulmonary artery. The Pulmonary artery carries blood toward the Lungs. After gas exchange, blood returns through the Pulmonary veins to the Left atrium. Which part would you like to explore together?";
