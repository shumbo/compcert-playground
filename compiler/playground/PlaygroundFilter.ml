(* Hooks that let the playground hide declarations that do not come from
   the user's source file (libc headers, builtins, CompCert's runtime
   helpers).  The build patches CompCert's printers and Rocq exporters to
   pass their lists of definitions through [defs] / [idents] /
   [globdecls]; PlaygroundCore installs the predicates. *)

let enabled = ref false

(** Is this global identifier one to hide? *)
let hide_ident : (BinNums.positive -> bool) ref = ref (fun _ -> false)

(** Is a C declaration at this location one to hide? *)
let hide_loc : (C.location -> bool) ref = ref (fun _ -> false)

let hidden id = !enabled && !hide_ident id

let defs l =
  if !enabled then List.filter (fun (id, _) -> not (!hide_ident id)) l else l

let idents l =
  if !enabled then List.filter (fun id -> not (!hide_ident id)) l else l

let globdecls l =
  if !enabled then List.filter (fun g -> not (!hide_loc g.C.gloc)) l else l
