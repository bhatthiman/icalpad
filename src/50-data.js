/* ================= iCalPad: example worksheets and help =================
   Worksheets are written as short scripts:
     # Heading      > text      @plot expr | x | from | to | motion | value | from | to | seconds
     @sketch width | height/width | [annotations]
   Any other line is a math line. A line that starts with || sits to the right of the one before it. */

function fromScript(text) {
  const out = []; let para = null;
  for (const raw of String(text).split('\n')) {
    let ln = raw.trim(), side = false;
    if (!ln) { para = null; continue; }
    if (ln.startsWith('||')) { side = true; ln = ln.slice(2).trim(); }
    let rg;
    if (ln[0] === '#') { rg = { type: 'text', src: ln, w: 760 }; para = null; }
    else if (ln[0] === '>') { const t = ln.slice(1).trim(); if (para && !side) { para.src += '\n' + t; continue; } rg = para = { type: 'text', src: t, w: side ? 330 : 640 }; }
    else if (ln.startsWith('@plot')) {
      const p = ln.slice(5).split('|').map(s => s.trim());
      rg = { type: 'plot', exprs: p[0] || '', xvar: p[1] || 'x', x0: p[2] || '0', x1: p[3] || '1', anim: p[4] || 'none', pvar: p[5] || 't', p0: p[6] || '0', p1: p[7] || '1', dur: parseFloat(p[8]) || 4, w: 520, h: 240 }; para = null;
    } else if (ln.startsWith('@sketch')) {
      const p = ln.slice(7).split('|').map(s => s.trim());
      rg = { type: 'image', img: '', w: +p[0] || 380, ar: +p[1] || 0.6, ann: JSON.parse(p[2] || '[]') }; para = null;
    } else { rg = { type: 'math', src: ln }; para = null; }
    if (side) rg.side = true;
    out.push(rg);
  }
  return out;
}

const EXAMPLES = [
  { id: 'start', name: 'Start here', note: 'A two-minute tour', title: 'Start here', s: `
# Welcome to iCalPad
> A free-form page for math. Click any empty spot and start typing. Drag anything to move it. Everything is live, so change a number and the rest follows.
## 1. Give values names and units
m := 1200 kg
|| v := 90 km/hr
|| > Lines are read top to bottom, and left to right along a row.
E_k := m*v^2/2 =
> Units convert themselves. Click an answer to pick other units, or type one after the equals sign.
v = mi/hr
## 2. End a line with -> for an exact, symbolic answer
int(x^2*sin(x), x) ->
solve(a*x^2 + b*x + c = 0, x) ->
|| diff(sin(x)^2, x) -> simplify
## 3. Ask a yes or no question
E_k <= 500 kJ
## 4. Plot, then press play
@plot sin(x - t)*e^(-x/8) | x | 0 | 20 | param | t | 0 | 2*pi | 4
|| @sketch 300 | 0.72 | [{"t":"pen","c":2,"p":[150,560,760,560,760,180,150,560]},{"t":"text","c":1,"x":430,"y":640,"s":"a"},{"t":"text","c":1,"x":800,"y":390,"s":"b"},{"t":"text","c":1,"x":380,"y":330,"s":"c"},{"t":"arrow","c":0,"p":[560,90,700,500]},{"t":"text","c":0,"x":330,"y":80,"s":"right angle"}]
## 5. Pictures and sketches
> Drop or paste a photo anywhere on the page, or add a blank sketch. Select it to draw on it with the pen, arrow and label tools, like the triangle next to the plot.` },
  { id: 'sym', name: 'Symbolic math tour', note: 'Algebra, calculus, exact numbers, matrices, LaTeX', title: 'Symbolic math tour', s: `
# Symbolic math tour
> End a line with -> for an exact answer. A keyword after the arrow steers it.
## Algebra
(x + 1)^4 -> expand
|| x^3 - 6x^2 + 11x - 6 -> factor
(a^2 - b^2)/(a - b) -> simplify
solve(a*x^2 + b*x + c = 0, x) ->
|| solve([2x + 3y = 12, x - y = 1], [x, y]) ->
## Calculus
diff(x^2*sin(x), x) ->
int(x^2*e^x, x) ->
int(1/(x^2 + 4), x) ->
|| int(sin(x)^2, x, 0, pi) ->
limit(sin(x)/x, x, 0) ->
|| taylor(cos(x), x, 0, 6) ->
## Exact numbers, then decimals
sqrt(72) ->
|| sin(pi/3) + cos(pi/6) ->
|| sqrt(72) =
## Matrices
A := [2, 1; 1, 3]
|| det(A) ->
|| inv(A) ->
A*[x; y] ->
## LaTeX
> Lines can be typed or pasted as LaTeX. The next one was entered as \`\\int_0^1 \\frac{x}{x^2+1}\\,dx ->\`. To go the other way, open a line's menu and choose Copy as LaTeX.
\\int_0^1 \\frac{x}{x^2+1}\\,dx ->` },
  { id: 'proj', name: 'Projectile motion', note: 'Units, a plot, and a swept angle', title: 'Projectile motion', s: `
# Projectile motion
> A ball is thrown from the ground. Change the speed or the angle and everything updates.
v_0 := 25 m/s
|| theta := 40 deg
> Time of flight, range and peak height
t_f := 2*v_0*sin(theta)/g = s
R := v_0^2*sin(2*theta)/g = m
h := (v_0*sin(theta))^2/(2*g) = m
> The path for this angle, then for every angle from 10° to 80°
y(x, a) := x*tan(a) - g*x^2/(2*v_0^2*cos(a)^2)
@plot y(x, theta) | x | 0 m | R
|| @plot max(y(x, a*deg), 0 m) | x | 0 m | 70 m | param | a | 10 | 80 | 6
> Which angle gives the longest range? Take the derivative of the range and set it to zero.
diff(v^2*sin(2*b)/G, b) ->
|| solve(cos(2*b) = 0, b) ->` },
  { id: 'derive', name: 'Derive first, numbers after', note: 'A formula worked out symbolically, then evaluated', title: 'Derive first, numbers after', s: `
# Derive a formula, then use it
> A beam on two supports carries a uniform load. Integrate the bending moment twice and solve for the two constants. No numbers are needed yet.
M(x) := w*L*x/2 - w*x^2/2
> Slope and deflection, each with a constant of integration
theta(x) := int(M(x), x)/EI + C_1
y(x) := int(theta(x), x) + C_2
> The deflection is zero at both supports
c := solve([y(0) = 0, y(L) = 0], [C_1, C_2]) ->
delta(x) := subs(y(x), C_1, c[1], C_2, c[2]) -> simplify
delta(L/2) ->
> That is the textbook $\\frac{5wL^4}{384EI}$. Now give the letters values and the same lines produce numbers.
w := 12 kN/m
|| L := 6 m
|| EI := 200 GPa * 8500 cm^4
delta(L/2) = mm
@plot delta(x) | x | 0 | L` },
  { id: 'check', name: 'A design check', note: 'Inputs, results, and pass or fail stamps', title: 'Beam check', s: `
# A simple design check
> A floor beam under a uniform load. Change any input and every line below updates.
## Inputs
w_D := 6 kN/m
|| w_L := 9 kN/m
|| L := 7.5 m
I_x := 21500 cm^4
|| S_x := 1160 cm^3
E := 200 GPa
|| F_y := 345 MPa
## Results
w := 1.2*w_D + 1.6*w_L =
V_max := w*L/2 =
|| M_max := w*L^2/8 =
M(x) := w*x*(L - x)/2
@plot M(x) | x | 0 | L
## Checks
> Bending stress against $0.9\\,F_y$
sigma := M_max/S_x =
|| sigma <= 0.9*F_y
> Live-load deflection against span/360
delta_L := 5*w_L*L^4/(384*E*I_x) = mm
|| delta_L <= L/360` },
  { id: 'modes', name: 'Matrices with units', note: 'Two masses on springs: solve, eigenvalues', title: 'Two masses on springs', s: `
# Two masses on springs
> Two masses joined by springs make a small matrix problem.
k_1 := 800 kN/m
|| k_2 := 600 kN/m
m_1 := 20 tonne
|| m_2 := 15 tonne
K := [k_1 + k_2, -k_2; -k_2, k_2]
|| Mm := [m_1, 0; 0, m_2]
## Static displacement under two forces
F := [15; 25] kN
|| u := lsolve(K, F) = mm
## Natural frequencies and periods
lambda := eigenvals(inv(Mm)*K)
omega_1 := sqrt(lambda[1]) =
|| omega_2 := sqrt(lambda[2]) =
T_1 := 2*pi/omega_1 = s
|| T_2 := 2*pi/omega_2 = s
> Mode shapes, one per column, scaled so the largest entry is 1
Phi := eigenvecs(inv(Mm)*K) =` },
  { id: 'anim', name: 'Animated plots', note: 'A travelling pulse, a standing wave, a traced response', title: 'Animated plots', s: `
# Animated plots
> Press play under a plot. Sweep a value to watch a family of curves, or trace one curve as it is drawn.
## A pulse travelling along a string
@plot e^(-(x - t)^2) | x | -3 | 12 | param | t | 0 | 9 | 5
## A standing wave
@plot sin(3*pi*x)*cos(t); sin(3*pi*x); -sin(3*pi*x) | x | 0 | 1 | param | t | 0 | 2*pi | 3
## A damped oscillation, traced in time
zeta := 0.05
|| omega_n := 2*pi*1.5
u(t) := e^(-zeta*omega_n*t)*cos(omega_n*sqrt(1 - zeta^2)*t)
@plot u(t); e^(-zeta*omega_n*t); -e^(-zeta*omega_n*t) | t | 0 | 6 | trace | | | | 5` },
];

const HELP = [
  ['Working on the page', [
    ['Click an empty spot, then type', 'Start a math line right there'],
    ['Drag a line, or its handle', 'Move it anywhere. Lines are read top to bottom, then left to right'],
    ['Drop or paste a picture', 'It lands where you drop it. Select it to draw on it'],
    ['Paste LaTeX', 'On an empty spot it becomes a math line'],
  ]],
  ['Define and calculate', [
    ['L := 6 m', 'Give a name a value. Typing : makes :='],
    ['w*L^2/8 =', 'End with = for a number'],
    ['v = mi/hr', 'Put a unit after = to convert'],
    ['f(x) := x^2 + 1', 'Define your own function'],
    ['T <= 80', 'A comparison becomes an OK / NG stamp'],
  ]],
  ['Symbolic answers', [
    ['int(x*sin(x), x) ->', 'End with -> for an exact answer'],
    ['(x+1)^3 -> expand', 'Keywords: simplify, expand, factor, float'],
    ['solve(x^2 = 4, x) ->', 'Solve an equation'],
    ['solve([x + y = 3, x - y = 1], [x, y]) ->', 'Solve several linear equations'],
    ['diff(f, x)   int(f, x, a, b)   limit(f, x, 0)', 'Derivative, integral, limit'],
    ['taylor(f, x, 0, 4)   sum(f, k, 1, n)   subs(f, x, 2)', 'Series, sums, substitution'],
    ['nsolve(cos(x) = x, x, 1) =', 'Numeric root from a starting value'],
  ]],
  ['Names and symbols', [
    ['M_max   sigma_y   f\'c   x1', 'Subscripts, Greek names, primes'],
    ['pi   e   inf   30 deg', 'Constants and degrees'],
    ['sqrt(x)   abs(x)   ln(x)   log(x)   exp(x)', 'Common functions'],
    ['min(a, b)   max(a, b)   if(a > b, a, b)', 'Choosing between values'],
  ]],
  ['Matrices', [
    ['A := [1, 2; 3, 4]', 'Commas between entries, semicolons between rows'],
    ['A*B   A^T   inv(A)   det(A)', 'Matrix algebra'],
    ['lsolve(K, F)   eigenvals(A)   v[2]', 'Solve K u = F, eigenvalues, one entry'],
  ]],
  ['Units', [
    ['m mm cm km in ft yd mi', 'Length'],
    ['kg gm tonne lb oz   s min hr day', 'Mass and time'],
    ['N kN lbf kip   Pa kPa MPa GPa psi ksi', 'Force and pressure'],
    ['J kJ kWh cal BTU   W kW hp   V ohm amp', 'Energy, power, electricity'],
    ['liter gal   Hz rpm   deg   g', 'Volume, frequency, angle, gravity'],
  ]],
];
