export type Example = { name: string; source: string };

export const EXAMPLES: Example[] = [
  {
    name: 'Sum of squares',
    source: `#include <stdio.h>

int sum_squares(int n) {
  int s = 0;
  for (int i = 1; i <= n; i++)
    s += i * i;
  return s;
}

int main(void) {
  printf("%d\\n", sum_squares(10));
  return 0;
}
`,
  },
  {
    name: 'Structs and pointers',
    source: `struct point { int x, y; };

static inline int sq(int v) { return v * v; }

int dist2(const struct point *a, const struct point *b) {
  return sq(a->x - b->x) + sq(a->y - b->y);
}

int closest(const struct point *pts, int n, const struct point *q) {
  int best = 0;
  for (int i = 1; i < n; i++)
    if (dist2(&pts[i], q) < dist2(&pts[best], q))
      best = i;
  return best;
}
`,
  },
  {
    name: 'Side effects in expressions',
    source: `/* CompCert C fixes an evaluation order for side effects;
   Clight pulls them out into temporaries. */
int counter;

int next(void) { return ++counter; }

int f(int *a, int i) {
  a[i++] = next() + next();
  return i ? a[--i] : 0;
}
`,
  },
  {
    name: 'Constant propagation & CSE',
    source: `/* Step through the RTL passes to watch the optimizations. */
int g(int x, int y) {
  int k = 4 * 8;
  int a = x * k + y;
  int b = x * k + y;      /* common subexpression */
  if (k > 10)             /* always true */
    return a + b;
  return a - b;
}
`,
  },
  {
    name: 'Switch & loops',
    source: `int classify(int c) {
  switch (c) {
  case ' ': case '\\t': case '\\n':
    return 0;
  case '0': case '1': case '2': case '3': case '4':
  case '5': case '6': case '7': case '8': case '9':
    return 1;
  default:
    return 2;
  }
}

int count_digits(const char *s) {
  int n = 0;
  while (*s)
    n += classify(*s++) == 1;
  return n;
}
`,
  },
  {
    name: 'Floating point',
    source: `double horner(const double *coef, int n, double x) {
  double r = 0.0;
  for (int i = n - 1; i >= 0; i--)
    r = r * x + coef[i];
  return r;
}

float to_single(double d) { return (float) d; }

long long trunc_to_ll(double d) { return (long long) d; }
`,
  },
  {
    name: 'Tail calls',
    source: `/* With -ftailcalls (the default), the recursive call becomes a jump. */
unsigned long gcd(unsigned long a, unsigned long b) {
  if (b == 0) return a;
  return gcd(b, a % b);
}

int is_even(unsigned n);
int is_odd(unsigned n) { return n == 0 ? 0 : is_even(n - 1); }
int is_even(unsigned n) { return n == 0 ? 1 : is_odd(n - 1); }
`,
  },
  {
    name: 'Rocq export (for VST)',
    source: `/* Open the "Rocq AST" tab to get the Clight AST as a .v file,
   as produced by clightgen. */
unsigned int sumarray(unsigned int a[], int n) {
  int i;
  unsigned s;
  i = 0;
  s = 0;
  while (i < n) {
    s += a[i];
    i++;
  }
  return s;
}
`,
  },
];
