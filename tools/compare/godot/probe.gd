extends Node
# The test probe for Godot's web build (tools/compare): every few frames it
# publishes, as JSON in window.__probeData, the game's state and where to click
# each verb, object, inventory item and dialog option (window pixels), the
# same as player/probe.js in the JS engine. Added as an autoload only to a
# test copy of the project (tools/compare/godot_build.js).

const EVERY := 6

var _frame := 0
var _objects := {}
var _ended := false
var _window


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if not OS.has_feature("web"):
		return
	_window = JavaScriptBridge.get_interface("window")
	JavaScriptBridge.eval("""
		window.__probeSpeed = 1;
		window.__probe = {
			engine: 'godot',
			_d: () => JSON.parse(window.__probeData || 'null'),
			size() { const d = this._d(); return d && d.size; },
			state() { const d = this._d(); return d && d.state; },
			where(t) {
				const d = this._d(); if (!d) return null;
				if (t.verb) return d.verbs[t.verb] || null;
				if (t.option) return d.options.find((o) => o.text === t.option) || null;
				if (t.object) return d.inventory[t.object] || d.objects[t.object] || null;
				return null;
			},
			setSpeed(x) { window.__probeSpeed = x; },
		};
	""", true)


func _process(_delta: float) -> void:
	if _window == null or _ended:
		return
	_frame += 1
	if _frame % EVERY:
		return
	var speed = float(_window.__probeSpeed)
	if speed > 0 and Engine.time_scale != speed:
		Engine.time_scale = speed
	_publish()


func _exit_tree() -> void:
	# get_tree().quit(): the game is over
	if _window == null:
		return
	_ended = true
	JavaScriptBridge.eval("""
		(() => { const d = JSON.parse(window.__probeData || 'null'); if (d) { d.state.ended = true; d.state.idle = false; window.__probeData = JSON.stringify(d); } })();
	""", true)


# canvas item point -> window pixels
func _screen(ci: CanvasItem, local: Vector2) -> Dictionary:
	var p: Vector2 = ci.get_viewport().get_screen_transform() * (ci.get_global_transform_with_canvas() * local)
	return {"x": p.x, "y": p.y}


func _visible(ci: CanvasItem) -> bool:
	return ci.is_inside_tree() and ci.is_visible_in_tree()


func _walk(n: Node, out: Array) -> void:
	out.append(n)
	for c in n.get_children():
		_walk(c, out)


# an item's collision shapes as polygons in canvas coordinates
func _polys(item: Node2D) -> Array:
	var out := []
	for c in item.get_children():
		if c is CollisionPolygon2D and not c.disabled and c.polygon.size() > 2:
			var xf: Transform2D = c.get_global_transform_with_canvas()
			out.append(Array(c.polygon).map(func(q): return xf * q))
		elif c is CollisionShape2D and not c.disabled and c.shape:
			var xf: Transform2D = c.get_global_transform_with_canvas()
			var r: Rect2 = c.shape.get_rect()
			out.append([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)].map(func(q): return xf * q))
	return out


# the point of the item's shapes nearest to their middle that no character
# covers (the player may stand in front of it), like player/probe.js
func _item_point(item: Node2D, others: Array) -> Dictionary:
	var mine := _polys(item)
	var vt: Transform2D = item.get_viewport().get_screen_transform()
	if mine.is_empty():
		var p: Vector2 = vt * item.get_global_transform_with_canvas().origin
		return {"x": p.x, "y": p.y}
	var big: Array = mine[0]
	for poly in mine:
		if poly.size() > big.size():
			big = poly
	var mid := Vector2.ZERO
	for q in big:
		mid += q
	mid /= big.size()
	var best = null
	var bd := INF
	for poly in mine:
		var pp := PackedVector2Array(poly)
		var lo: Vector2 = poly[0]
		var hi: Vector2 = poly[0]
		for q in poly:
			lo = lo.min(q)
			hi = hi.max(q)
		var x := floorf(lo.x)
		while x <= hi.x:
			var y := floorf(lo.y)
			while y <= hi.y:
				var q := Vector2(x, y)
				if Geometry2D.is_point_in_polygon(q, pp) and not others.any(func(o): return Geometry2D.is_point_in_polygon(q, PackedVector2Array(o))):
					var d := q.distance_squared_to(mid)
					if d < bd:
						bd = d
						best = q
				y += 8
			x += 8
	var p: Vector2 = vt * (best if best != null else mid)
	return {"x": p.x, "y": p.y}


func _room_objects(nodes: Array) -> Dictionary:
	var items := []
	for n in nodes:
		if n is ESCItem and n.global_id != "" and _visible(n) and escoria.object_manager.has(n.global_id):
			var o = escoria.object_manager.get_object(n.global_id)
			if o and o.active:
				items.append(n)
	var objects := {}
	for n in items:
		var others := []
		for m in items:
			if m != n and m.is_movable:
				others.append_array(_polys(m))
		objects[n.global_id] = _item_point(n, others)
	return objects


# the room object under the mouse
func _hover():
	var im = escoria.inputs_manager
	var h = im.hover_stack.get_top_item() if im.hover_stack else null
	if not is_instance_valid(h):
		h = im._hovered_element
	return h.global_id if is_instance_valid(h) else null


func _publish() -> void:
	var root := get_tree().root
	var nodes := []
	_walk(root, nodes)
	var verbs := {}
	var inventory := {}
	var options := []
	var speech = null
	var chooser := false
	# the objects' points cost more: every 5th time
	var objects := _objects
	if (_frame / EVERY) % 5 == 0:
		objects = _room_objects(nodes)
		_objects = objects
	for n in nodes:
		if n is ESCItem:
			pass
		elif n is ESCInventoryButton and _visible(n):
			inventory[n.global_id] = _screen(n, n.size / 2)
		elif n is ESCDialogOptionsChooser and _visible(n):
			chooser = true
			var all := []
			_walk(n, all)
			for b in all:
				if b is Button and _visible(b) and b.text.strip_edges() != "" and b.text.length() > 1:
					var q := _screen(b, Vector2(min(b.size.x / 2, 40), b.size.y / 2))
					q["text"] = b.text
					options.append(q)
		elif n is BaseButton and _visible(n) and n.get_parent() and String(n.get_parent().name) in ["actions", "verbs_menu"]:
			verbs[String(n.name)] = _screen(n, n.size / 2)
	# speech: a visible text in the dialog layer that is not the chooser
	var dl = root.find_child("dialog_layer", true, false)
	if dl:
		var all := []
		_walk(dl, all)
		for t in all:
			if (t is RichTextLabel or t is Label) and _visible(t) and t.text.strip_edges() != "":
				speech = t.text if t is Label else t.get_parsed_text()
				break
	var room = escoria.main.current_scene if escoria.main else null
	var player = room.player if room and "player" in room else null
	var walking: bool = player != null and player._movable != null and player._movable.task != ESCMovable.MovableTask.NONE
	# what keeps the game busy (idle when nothing)
	var busy := []
	if not escoria.event_manager.is_channel_free("_front"):
		busy.append("event")
	if not escoria.event_manager.events_queue["_front"].is_empty():
		busy.append("queue")
	if escoria.event_manager._changing_scene:
		busy.append("scene change")
	if escoria.inputs_manager.input_mode != escoria.inputs_manager.INPUT_ALL:
		busy.append("input %s" % escoria.inputs_manager.input_mode)
	if escoria.current_state != escoria.GameState.DEFAULT:
		busy.append("state %s" % escoria.current_state)
	if speech != null:
		busy.append("speech")
	if chooser:
		busy.append("chooser")
	if walking:
		busy.append("camina")
	var idle: bool = busy.is_empty()
	var globals := {}
	var all_globals: Dictionary = escoria.globals_manager.get_globals()
	for k in all_globals:
		if not escoria.globals_manager._reserved_globals.has(k):
			var v = all_globals[k]
			globals[k] = v if v == null or v is bool or v is int or v is float or v is String else str(v)
	var inv: Array = escoria.inventory_manager.items_in_inventory().duplicate()
	inv.sort()
	var ws := DisplayServer.window_get_size()
	var data := {
		"size": {"w": ws.x, "h": ws.y},
		"state": {
			"room": room.global_id if room and "global_id" in room else null,
			"idle": idle,
			"input": escoria.inputs_manager.input_mode == escoria.inputs_manager.INPUT_ALL,
			"busy": busy,
			"chooser": chooser,
			"options": options.map(func(o): return o.text),
			"speech": speech,
			"hover": _hover(),
			"action": escoria.action_manager.current_action if escoria.action_manager.current_action != "" else null,
			"inventory": inv,
			"globals": globals,
			"ended": false,
		},
		"verbs": verbs, "objects": objects, "inventory": inventory, "options": options,
	}
	_window.__probeData = JSON.stringify(data)
