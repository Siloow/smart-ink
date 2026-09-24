export interface MeasureStep { key: string; title: string; kind?: string; view?: string; instruction: string; tip: string; angle?: number }
export const MEASURE_STEPS: MeasureStep[] = [
  {key:'height',title:'Your height',kind:'length',view:'body',instruction:'Stand barefoot with your back against a wall. Measure from the floor to the top of your head.',tip:'Keep your head level. A book held flat on your head can help mark the height.'},
  {key:'neck',title:'Around your neck',instruction:'Wrap a flexible tape around your neck at the highlighted band, just above the shoulders.',tip:'Keep the tape comfortably against the skin. Do not pull it tight.'},
  {key:'chest',title:'Chest / bust',instruction:'Take the tape around the chest at the highlighted level, across the fullest part of the chest or bust.',tip:'Keep it level around your back, relax your arms, and breathe normally.'},
  {key:'waist',title:'Around your waist',instruction:'Wrap the tape around your waist at the highlighted band between the ribs and hips.',tip:'Stand naturally without pulling your stomach in. The band shows this guide’s measurement location.'},
  {key:'hips',title:'Around your hips',instruction:'Measure around your hips and seat at the highlighted band.',tip:'Keep the tape level. Match the shown band as closely as you can; this is an estimated template landmark.'},
  {key:'upperArm',title:'Around your upper arm',instruction:'With your arm relaxed, wrap the tape around the highlighted part of your upper arm.',tip:'Use the same arm for all the arm steps. This version applies those values to both sides.',angle:.35},
  {key:'armLength',title:'Wrist to elbow',kind:'length',instruction:'Measure from your wrist crease to the elbow landmark shown by the line.',tip:'Keep your arm gently extended. You will use this length to locate the next three bands.',angle:.35},
  {key:'wrist',title:'Around your wrist',instruction:'Wrap the tape around your wrist at the highlighted band.',tip:'Keep your hand relaxed and let the tape touch the skin without squeezing.',angle:.35},
  {key:'forearmLow',title:'One third up your forearm',instruction:'From the wrist, mark one third of your wrist-to-elbow length. Measure around the arm at that point.',tip:'Use the highlighted band as a guide. Keep the tape perpendicular to your forearm.',angle:.35},
  {key:'forearm',title:'Two thirds up your forearm',instruction:'From the wrist, mark two thirds of your wrist-to-elbow length. Measure around the arm there.',tip:'Keep your arm relaxed, using the same arm and wrist starting point.',angle:.35},
  {key:'belowElbow',title:'Just below your elbow',instruction:'Measure around the forearm at 95% of the wrist-to-elbow length, just short of the elbow.',tip:'The bright band shows the section. Avoid measuring directly over the elbow joint.',angle:.35},
  {key:'inseam',title:'Your inseam',kind:'length',instruction:'Standing barefoot, measure from the floor up the inside of your leg to the crotch.',tip:'Another person can help. The line uses an estimated crotch landmark on this template.',view:'legs'},
  {key:'thigh',title:'Around your thigh',instruction:'Wrap the tape around your upper thigh at the highlighted band below the crotch.',tip:'Stand with your weight distributed evenly. Use the same leg for the next steps.',angle:.3},
  {key:'calf',title:'Around your calf',instruction:'Wrap the tape around your calf at the highlighted band.',tip:'Keep the tape level and your leg relaxed. This version applies the value to both legs.',angle:.3},
  {key:'ankle',title:'Around your ankle',instruction:'Wrap the tape around your ankle at the highlighted band above the foot.',tip:'Keep the tape against the skin without tightening it.',angle:.3},
];

