import os
import re
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '2222')

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.context_processor
def inject_globals():
    logo_path = os.path.join(app.static_folder, 'logo.png')
    return {'logo_exists': os.path.exists(logo_path)}


RISKS = {
    1: ("Художник ушёл",
        "Генератор смыслов, вдохновивший проект, отказался участвовать. "
        "Говорит: «Вы используете мои идеи, но не платите и не указываете авторство». Что делать?"),
    2: ("Данные врут",
        "Выяснилось, что исследование, на котором построено ТЗ, было проведено 5 лет назад. "
        "Ситуация на территории изменилась. ТЗ может быть неактуально. Что делать?"),
    3: ("Инвестор диктует",
        "Появился инвестор, готовый вложить большие деньги, но требует: убрать генераторов из модели "
        "прибыли, заменить уникальную технологию на франшизу, удвоить производство. Что делать?"),
    4: ("Ключевой участник уехал",
        "Продюсер-модератор, который всё собирал, переехал в другой город. "
        "Без него никто не знает, как работает схема кооперации. Что делать?"),
    5: ("Технология не работает",
        "Решатели создали прототип, но он оказался слишком дорогим для массового производства. "
        "Делатели говорят: дешевле купить китайскую линию. Что делать?"),
    6: ("Экспортёр замкнулся",
        "Отельер, который должен был обеспечить экспорт, решил использовать продукт только для своей "
        "гостиницы и не делиться потоками. Что делать?"),
    7: ("Администрация против",
        "Городская администрация считает проект «несерьёзным» и отказывает в поддержке. "
        "Требует «нормальный благоустроительный проект» вместо вашей технологии. Что делать?"),
    8: ("Жители не поддержали",
        "Вы запустили продукт, но целевая аудитория (жители района) не заинтересовалась. "
        "Говорят: «нам это не нужно, нам нужна нормальная парковка». Что делать?"),
}


def game_required(f):
    """Protects round pages: user must have loaded a game (entered GAME_PASSWORD)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('current_game_id'):
            return redirect(url_for('games'))
        return f(*args, **kwargs)
    return decorated


def get_current_game():
    game_id = session.get('current_game_id')
    if not game_id:
        return None
    result = supabase.table('games').select('*').eq('id', game_id).limit(1).execute()
    return result.data[0] if result.data else None


def update_game_data(game_id, new_fields):
    result = supabase.table('games').select('data').eq('id', game_id).limit(1).execute()
    current = result.data[0].get('data', {}) if result.data else {}
    current.update(new_fields)
    supabase.table('games').update({'data': current}).eq('id', game_id).execute()


def get_list_items(data, prefix):
    """Return list items stored as {prefix}_{timestamp}_text/votes keys.

    Items are sorted chronologically by their timestamp ID.
    Items with a {prefix}_{id}_del flag are excluded (tombstoned).
    """
    pat = re.compile(r'^' + re.escape(prefix) + r'_(\d+)_text$')
    items = []
    for key, val in data.items():
        m = pat.match(key)
        if not m:
            continue
        ts = m.group(1)
        if data.get(prefix + '_' + ts + '_del'):
            continue
        items.append({
            'id':    ts,
            'text':  val or '',
            'votes': data.get(prefix + '_' + ts + '_votes'),
        })
    items.sort(key=lambda x: x['id'])
    return items


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if session.get('current_game_id'):
        return redirect(url_for('round1'))
    return redirect(url_for('games'))


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('games'))


@app.route('/games')
def games():
    result = (supabase.table('games')
              .select('id, name, created_at')
              .eq('is_visible', 1)
              .order('created_at', desc=True)
              .execute())
    games_list = result.data or []
    return render_template('games.html',
                           games=games_list,
                           current_game_id=session.get('current_game_id'))


@app.route('/games/new', methods=['POST'])
def new_game():
    if request.form.get('admin_password') != ADMIN_PASSWORD:
        return redirect(url_for('games', error='wrong_code'))

    name = 'Игра ' + datetime.now().strftime('%d.%m.%Y %H:%M')
    result = supabase.table('games').insert({'name': name, 'data': {}, 'is_visible': 1}).execute()
    new_id = result.data[0]['id']
    session['current_game_id'] = new_id

    return redirect(url_for('game_info'))


@app.route('/games/<game_id>/load', methods=['POST'])
def load_game(game_id):
    result = supabase.table('games').select('name').eq('id', game_id).limit(1).execute()
    if not result.data:
        return redirect(url_for('games', error='wrong_game_code'))
    game_name = result.data[0]['name']
    m = re.match(r'Игра (\d{2})\.(\d{2})\.\d{4}', game_name)
    expected_code = (m.group(1) + m.group(2)) if m else None
    if not expected_code or request.form.get('game_password') != expected_code:
        return redirect(url_for('games', error='wrong_game_code'))
    session['current_game_id'] = game_id
    return redirect(url_for('round1'))


@app.route('/games/<game_id>/delete', methods=['POST'])
def delete_game(game_id):
    if request.form.get('admin_password') != ADMIN_PASSWORD:
        return redirect(url_for('games', error='wrong_delete_code'))
    supabase.table('games').delete().eq('id', game_id).execute()
    if session.get('current_game_id') == game_id:
        session.pop('current_game_id', None)
    return redirect(url_for('games'))


@app.route('/game-info')
def game_info():
    game = get_current_game()
    return render_template('game_info.html', game=game)


@app.route('/round/1')
@game_required
def round1():
    game = get_current_game()
    return render_template('round1.html', game=game, data=game.get('data', {}))


@app.route('/round/2')
@game_required
def round2():
    game = get_current_game()
    data = game.get('data', {})
    return render_template('round2.html', game=game, data=data,
                           cc_items=get_list_items(data, 'r2_cc'),
                           cp_items=get_list_items(data, 'r2_cp'))


@app.route('/round/3')
@game_required
def round3():
    game = get_current_game()
    return render_template('round3.html', game=game, data=game.get('data', {}))


@app.route('/round/4')
@game_required
def round4():
    game = get_current_game()
    return render_template('round4.html', game=game, data=game.get('data', {}))


@app.route('/round/5')
@game_required
def round5():
    game = get_current_game()
    return render_template('round5.html', game=game, data=game.get('data', {}))


@app.route('/round/6')
@game_required
def round6():
    game = get_current_game()
    data = game.get('data', {})
    risk_num = data.get('r5_risk')
    risk = RISKS.get(int(risk_num)) if risk_num else None
    return render_template('round6.html', game=game, data=data,
                           risk=risk, risks_json=_risks_json())


@app.route('/round/7')
@game_required
def round7():
    game = get_current_game()
    return render_template('checklist.html', game=game, data=game.get('data', {}))


@app.route('/round/8')
@game_required
def round8():
    game = get_current_game()
    return render_template('round8.html', game=game)


# ── API ───────────────────────────────────────────────────────────────────────

@app.route('/api/save', methods=['POST'])
@game_required
def api_save():
    fields = request.get_json()
    if not fields:
        return jsonify({'error': 'no data'}), 400
    update_game_data(session['current_game_id'], fields)
    return jsonify({'ok': True})


@app.route('/api/data')
@game_required
def api_data():
    game = get_current_game()
    resp = jsonify(game.get('data', {}) if game else {})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/api/risks')
def api_risks():
    return jsonify(_risks_json())


def _risks_json():
    return {str(k): {'title': v[0], 'text': v[1]} for k, v in RISKS.items()}


@app.route('/checklist')
@game_required
def checklist():
    return redirect(url_for('round7'))


@app.route('/print/r3-final')
@game_required
def print_r3_final():
    game = get_current_game()
    data = game.get('data', {})
    return render_template('print_r3.html', game=game, data=data)


@app.route('/print/r6')
@game_required
def print_r6():
    game = get_current_game()
    data = game.get('data', {})
    return render_template('print_r6.html', game=game, data=data)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
