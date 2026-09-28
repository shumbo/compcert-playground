(* In-process driver for the CompCert playground.

   Runs the ccomp pipeline (and the clightgen exporters) on C code that
   has already been preprocessed, and returns every intermediate
   representation as a string instead of writing <file>.<ext> dumps next
   to the source.  The printers still go through out_channels, so the
   dumps are written to a scratch directory and read back. *)

open Clflags

type output = {
  ok : bool;
  diagnostics : string;
  dumps : (string * string) list;
}

let version = Version.version

(* Diagnostics are printed on Format.err_formatter; collect them. *)

let diag_buf = Buffer.create 4096

let () =
  Format.pp_set_formatter_output_functions Format.err_formatter
    (Buffer.add_substring diag_buf) (fun () -> ())

let flush_diagnostics () =
  Format.pp_print_flush Format.err_formatter ();
  let s = Buffer.contents diag_buf in
  Buffer.clear diag_buf;
  s

(* Command-line style options accepted by the playground.  Dumps, output
   files and the choice of pipeline are controlled by the playground
   itself, so only options that change what the compiler does are
   accepted here. *)

let f_opt name r =
  Commandline.[Exact ("-f" ^ name), Set r; Exact ("-fno-" ^ name), Unset r]

let optimization_options = [
  option_ftailcalls; option_fifconversion; option_fconstprop; option_fcse;
  option_fredundancy; option_finline; option_finline_functions_called_once;
]

let set_all opts () = List.iter (fun r -> r := true) opts
let unset_all opts () = List.iter (fun r -> r := false) opts

let cmdline_actions =
  let open Commandline in
  [ Exact "-O0", Unit (unset_all optimization_options);
    Exact "-O", Unit (set_all optimization_options);
    _Regexp "-O[123]$", Unit (set_all optimization_options);
    Exact "-Os", Set option_Osize;
    Exact "-Obranchless", Set option_Obranchless;
    Exact "-ffloat-const-prop", Integer (fun n -> option_ffloatconstprop := n);
    Exact "-fpic", Set option_fpic;
    Exact "-fPIC", Set option_fpic;
    Exact "-fno-pic", Unset option_fpic;
    Exact "-fno-PIC", Unset option_fpic;
    Exact "-fpie", Set option_fpie;
    Exact "-fPIE", Set option_fpie;
    Exact "-fno-pie", Unset option_fpie;
    Exact "-fno-PIE", Unset option_fpie;
    Exact "-g", Set option_g;
  ]
  @ f_opt "common" option_fcommon
  @ f_opt "tailcalls" option_ftailcalls
  @ f_opt "if-conversion" option_fifconversion
  @ f_opt "const-prop" option_fconstprop
  @ f_opt "cse" option_fcse
  @ f_opt "redundancy" option_fredundancy
  @ f_opt "inline" option_finline
  @ f_opt "inline-functions-called-once" option_finline_functions_called_once
  @ f_opt "fpu" option_ffpu
  @ CommonOptions.language_support_options
  @ Diagnostics.warning_options
  @ [ Prefix "-", Self (fun s ->
        raise (Commandline.CmdError (Printf.sprintf "unknown option `%s'" s))) ]

let parse_args args =
  if Array.length args > 0 then
    Commandline.parse_array cmdline_actions args 0 (Array.length args - 1)

(* Scratch files *)

let read_file name =
  if Sys.file_exists name then begin
    let ic = open_in_bin name in
    let s = really_input_string ic (in_channel_length ic) in
    close_in ic;
    Sys.remove name;
    Some s
  end else None

let write_file name contents =
  let oc = open_out_bin name in
  output_string oc contents;
  close_out oc

let scratch = "pg_out"

let clear_destinations () =
  Cprint.destination := None;
  PrintCsyntax.destination := None;
  PrintClight.destination := None;
  PrintCminor.destination := None;
  PrintRTL.destination := None;
  PrintLTL.destination := None;
  PrintMach.destination := None;
  Regalloc.destination_alloctrace := None

let rtl_passes = 9

(* Identifiers are interned in global tables that outlive a compilation.
   Restore them to their initial state before each run so that generated
   names (e.g. __stringlit_N) do not depend on earlier runs. *)

let initial_atoms = ref None

let save_atoms () =
  initial_atoms := Some (Hashtbl.copy Camlcoq.atom_of_string,
                         Hashtbl.copy Camlcoq.string_of_atom,
                         !Camlcoq.next_atom)

let restore_atoms () =
  match !initial_atoms with
  | None -> ()
  | Some (a2s, s2a, next) ->
      let restore dst src =
        Hashtbl.reset dst; Hashtbl.iter (Hashtbl.add dst) src in
      restore Camlcoq.atom_of_string a2s;
      restore Camlcoq.string_of_atom s2a;
      Camlcoq.next_atom := next

(* Run [f] with fresh diagnostics, turning CompCert's error exits into a
   failed [output]. *)

let run args f =
  PlaygroundFlags.restore ();
  Diagnostics.reset ();
  ignore (flush_diagnostics ());
  restore_atoms ();
  PrintAsmaux.next_label := 100;
  clear_destinations ();
  let dumps = ref [] in
  let add key = function
    | Some s -> dumps := (key, s) :: !dumps
    | None -> () in
  let ok =
    try
      parse_args args;
      f add;
      Diagnostics.check_errors ();
      true
    with
    | Commandline.CmdError msg ->
        Format.eprintf "error: %s@." msg; false
    | Diagnostics.Abort -> false
    | Sys_error msg ->
        Format.eprintf "error: %s@." msg; false
    | Stack_overflow ->
        Format.eprintf "internal error: stack overflow@."; false
    | e ->
        Format.eprintf "internal error: %s@." (Printexc.to_string e); false in
  clear_destinations ();
  (* Some errors (e.g. from the parser) go straight to stderr; the host
     captures those, so make sure they have been written out. *)
  flush stdout; flush stderr;
  { ok; diagnostics = flush_diagnostics (); dumps = List.rev !dumps }

(* From preprocessed C to assembly, with all intermediate dumps. *)

let compile ~filename ~source ~args =
  run args (fun add ->
    let ifile = scratch ^ ".i" in
    write_file ifile source;
    let dest ext = Some (scratch ^ ext) in
    Cprint.destination := dest ".parsed.c";
    PrintCsyntax.destination := dest ".compcert.c";
    PrintClight.destination := dest ".light.c";
    PrintCminor.destination := dest ".cm";
    PrintRTL.destination := dest ".rtl";
    PrintLTL.destination := dest ".ltl";
    PrintMach.destination := dest ".mach";
    DebugInit.init ();
    let collect () =
      add "parsed" (read_file (scratch ^ ".parsed.c"));
      add "compcert_c" (read_file (scratch ^ ".compcert.c"));
      add "clight" (read_file (scratch ^ ".light.c"));
      add "cminor" (read_file (scratch ^ ".cm"));
      for i = 0 to rtl_passes - 1 do
        add (Printf.sprintf "rtl.%d" i)
          (read_file (Printf.sprintf "%s.rtl.%d" scratch i))
      done;
      add "ltl" (read_file (scratch ^ ".ltl"));
      add "mach" (read_file (scratch ^ ".mach")) in
    Fun.protect ~finally:(fun () -> collect (); ignore (read_file ifile))
      (fun () ->
        let csyntax = Frontend.parse_c_file filename ifile in
        match Compiler.apply_partial
                (Compiler.transf_c_program csyntax)
                Asmexpand.expand_program with
        | Errors.OK asm ->
            let sfile = scratch ^ ".s" in
            let oc = open_out sfile in
            PrintAsm.print_program oc asm;
            close_out oc;
            add "asm" (read_file sfile)
        | Errors.Error msg ->
            Diagnostics.fatal_error (Diagnostics.file_loc filename) "%a"
              Driveraux.print_error msg))

(* From preprocessed C to the Rocq (Coq) AST, as clightgen does. *)

type export_mode = Clight | Csyntax

let to_string print =
  let buf = Buffer.create 65536 in
  let fmt = Format.formatter_of_buffer buf in
  print fmt;
  Format.pp_print_flush fmt ();
  Buffer.contents buf

let export ~filename ~source ~args ~mode ~normalize =
  run args (fun add ->
    let ifile = scratch ^ ".i" in
    write_file ifile source;
    Fun.protect ~finally:(fun () -> ignore (read_file ifile)) (fun () ->
      let csyntax = Frontend.parse_c_file filename ifile in
      match mode with
      | Csyntax ->
          add "rocq" (Some (to_string (fun fmt ->
            ExportCsyntax.print_program fmt csyntax filename)))
      | Clight ->
          let loc = Diagnostics.file_loc filename in
          let clight =
            match SimplExpr.transl_program csyntax with
            | Errors.Error msg ->
                Diagnostics.fatal_error loc "%a" Driveraux.print_error msg
            | Errors.OK p ->
                match SimplLocals.transf_program p with
                | Errors.Error msg ->
                    Diagnostics.fatal_error loc "%a" Driveraux.print_error msg
                | Errors.OK p' ->
                    if normalize then Clightnorm.norm_program p' else p' in
          add "rocq" (Some (to_string (fun fmt ->
            ExportClight.print_program fmt clight filename normalize)))))

let () =
  Camlcoq.use_canonical_atoms := true;
  Frontend.init ();
  save_atoms ()
