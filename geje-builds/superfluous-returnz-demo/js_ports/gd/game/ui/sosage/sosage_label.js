// Translated from res://game/ui/sosage/sosage_label.gd by tools/gd2js. Don't edit: translate the .gd again.
export default function (gd) {
  const { op, call, iter, truthy, G } = gd;
  const Kind = Object.freeze({ PLAIN: 0, CURSOR_LEFT: 1, CURSOR_RIGHT: 2, GOTO_LEFT: 3, GOTO_RIGHT: 4, OPEN_LEFT: 5, OPEN_RIGHT: 6, BUTTON: 7 });
  const HEIGHT = 50.0;
  const RADIUS = 25.0;
  const FONT = gd.preload("res://game/fonts/PTN77F.ttf");
  const FONT_SIZE = 40;
  const LABEL_ALPHA = (100.0 / 255.0);
  class SosageLabel extends gd.base("Control") {
    constructor(...args) {
      super(...args);
      this.__field("text", "");
      this.__field("kind", gd.member(Kind, "PLAIN"));
      this.__field("__p_highlighted", false);
      this.__field("_anchor_x", 0.0);
      this.__field("_text_center_x", 0.0);
    }
    get highlighted() { return this.__p_highlighted; }
    set highlighted(value) {
      this.__p_highlighted = value;
      this.queue_redraw();
    }
    static make(p_text, p_kind) {
      let l = gd.new_("SosageLabel", []);
      l.text = p_text;
      l.kind = p_kind;
      l.mouse_filter = gd.member(gd.cls("Control"), "MOUSE_FILTER_IGNORE");
      call(l, "_layout");
      return l;
    }
    _layout() {
      let tw = 0.0;
      if (truthy(op.ne(this.text, ""))) {
        tw = gd.member(call(FONT, "get_string_size", this.text, G.HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE), "x");
      }
      let w = 0.0;
      {
        const __m1 = this.kind;
        if (op.eq(__m1, gd.member(Kind, "PLAIN"))) {
          w = op.add(tw, 70);
          this._anchor_x = op.div(w, 2);
          this._text_center_x = op.div(w, 2);
        }
        else if (op.eq(__m1, gd.member(Kind, "CURSOR_LEFT"))) {
          w = op.add(tw, 65);
          this._anchor_x = 0;
          this._text_center_x = op.add(37.5, op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "CURSOR_RIGHT"))) {
          w = op.add(tw, 65);
          this._anchor_x = w;
          this._text_center_x = op.sub(op.sub(w, 37.5), op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "GOTO_LEFT"))) {
          w = op.add(tw, 45);
          this._anchor_x = 0;
          this._text_center_x = op.add(22.5, op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "GOTO_RIGHT"))) {
          w = op.add(tw, 45);
          this._anchor_x = w;
          this._text_center_x = op.sub(op.sub(w, 22.5), op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "OPEN_LEFT"))) {
          w = op.add(tw, 90);
          this._anchor_x = RADIUS;
          this._text_center_x = op.add(65, op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "OPEN_RIGHT"))) {
          w = op.add(tw, 90);
          this._anchor_x = op.sub(w, RADIUS);
          this._text_center_x = op.sub(op.sub(w, 65), op.div(tw, 2));
        }
        else if (op.eq(__m1, gd.member(Kind, "BUTTON"))) {
          w = HEIGHT;
          this._anchor_x = RADIUS;
          this._text_center_x = RADIUS;
        }
      }
      this.size = G.Vector2(w, HEIGHT);
      this.pivot_offset = G.Vector2(this._anchor_x, op.div(HEIGHT, 2));
      this.queue_redraw();
    }
    place(point) {
      this.position = op.sub(point, G.Vector2(this._anchor_x, op.div(HEIGHT, 2)));
    }
    set_text(p_text) {
      this.text = p_text;
      this._layout();
    }
    _draw() {
      if (truthy(op.eq(this.kind, gd.member(Kind, "BUTTON")))) {
        let c = (truthy(this.highlighted) ? G.Color(0.5, 0.5, 0.5) : G.Color(0, 0, 0));
        this.draw_circle(G.Vector2(RADIUS, RADIUS), RADIUS, c);
        return;
      }
      let sb = gd.new_("StyleBoxFlat", []);
      sb.bg_color = G.Color(0, 0, 0, LABEL_ALPHA);
      sb.anti_aliasing = true;
      let left_round = !op.in(this.kind, [gd.member(Kind, "CURSOR_LEFT"), gd.member(Kind, "GOTO_LEFT")]);
      let right_round = !op.in(this.kind, [gd.member(Kind, "CURSOR_RIGHT"), gd.member(Kind, "GOTO_RIGHT")]);
      sb.corner_radius_top_left = (truthy(left_round) ? G.int(RADIUS) : 0);
      sb.corner_radius_bottom_left = (truthy(left_round) ? G.int(RADIUS) : 0);
      sb.corner_radius_top_right = (truthy(right_round) ? G.int(RADIUS) : 0);
      sb.corner_radius_bottom_right = (truthy(right_round) ? G.int(RADIUS) : 0);
      this.draw_style_box(sb, G.Rect2(gd.member(gd.cls("Vector2"), "ZERO"), gd.member(this, "size")));
      if (truthy(op.ne(this.text, ""))) {
        let tw = gd.member(call(FONT, "get_string_size", this.text, G.HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE), "x");
        let ascent = call(FONT, "get_ascent", FONT_SIZE);
        let descent = call(FONT, "get_descent", FONT_SIZE);
        let baseline = op.add(op.div(HEIGHT, 2), op.div((op.sub(ascent, descent)), 2));
        this.draw_string(FONT, G.Vector2(op.sub(this._text_center_x, op.div(tw, 2)), baseline), this.text, G.HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE, gd.member(gd.cls("Color"), "WHITE"));
      }
    }
  }
  Object.assign(SosageLabel, { Kind, HEIGHT, RADIUS, FONT, FONT_SIZE, LABEL_ALPHA });
  return SosageLabel;
}
