(* JavaScript binding: exposes [globalThis.compcert] to the web worker. *)

open Js_of_ocaml

let to_js (o : PlaygroundCore.output) =
  let dumps = Js.Unsafe.obj [||] in
  List.iter
    (fun (k, v) -> Js.Unsafe.set dumps (Js.string k) (Js.string v))
    o.dumps;
  Js.Unsafe.obj [|
    "ok", Js.Unsafe.inject (Js.bool o.ok);
    "diagnostics", Js.Unsafe.inject (Js.string o.diagnostics);
    "dumps", Js.Unsafe.inject dumps;
  |]

let args_of_js a =
  Array.map Js.to_string (Js.to_array a)

let compile filename source args =
  to_js (PlaygroundCore.compile
           ~filename:(Js.to_string filename)
           ~source:(Js.to_string source)
           ~args:(args_of_js args))

let export filename source args mode normalize =
  let mode =
    if Js.to_string mode = "csyntax"
    then PlaygroundCore.Csyntax
    else PlaygroundCore.Clight in
  to_js (PlaygroundCore.export
           ~filename:(Js.to_string filename)
           ~source:(Js.to_string source)
           ~args:(args_of_js args)
           ~mode ~normalize:(Js.to_bool normalize))

let () =
  Js.Unsafe.set Js.Unsafe.global (Js.string "compcert")
    (Js.Unsafe.obj [|
       "version", Js.Unsafe.inject (Js.string PlaygroundCore.version);
       "compile", Js.Unsafe.inject (Js.wrap_callback compile);
       "exportRocq", Js.Unsafe.inject (Js.wrap_callback export);
     |])
