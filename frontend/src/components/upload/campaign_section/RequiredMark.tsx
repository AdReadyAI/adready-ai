/**
 * The red `*` beside a field label whose value gates submit.
 *
 * Its own file rather than a helper inside CampaignForm: a module that exports
 * both a component and something else trips the react-refresh lint rule (see
 * AdvancedFieldsSection), and this is shared markup anyway.
 *
 * `aria-hidden` is deliberate. The asterisk is decoration — assistive tech
 * learns a field is required from `aria-required` on the control itself, so
 * announcing the glyph as well turns every label into "Product URL star".
 * The two always ship together: marking a label here without setting
 * `aria-required` on its input is exactly the mismatch this pairing prevents.
 *
 * `announce` covers the case with no control to carry that attribute — a
 * section heading over a dropzone, where the requirement is "this section has
 * a file in it", not "this input has a value". There the glyph is the only
 * signal on screen, so the requirement is voiced here instead. Passing it on a
 * field whose input already sets `aria-required` makes screen readers say
 * "required" twice.
 */
type Props = {
  /** Voice the requirement here — only when no control sets `aria-required`. */
  announce?: boolean;
};

export default function RequiredMark({ announce = false }: Props) {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-[#B3261E]">
        *
      </span>
      {announce && <span className="sr-only"> (required)</span>}
    </>
  );
}
