(function () {
  const API_BASE = (window.API_BASE || 'http://localhost:5000') + '/api';

  const app = angular.module('dohiveApp', []);

  // Cross-page sync helper
  let dohiveChannel = null;
  function getChannel() {
    if (!dohiveChannel && typeof BroadcastChannel !== 'undefined') {
      try { dohiveChannel = new BroadcastChannel('dohive-sync'); } catch (e) { dohiveChannel = null; }
    }
    return dohiveChannel;
  }
  function notifySync() {
    const payload = { t: Date.now() };
    const ch = getChannel();
    if (ch) { try { ch.postMessage(payload); } catch (e) {} }
    try { localStorage.setItem('dohive.sync', String(payload.t)); } catch (e) {}
  }

  app.factory('Auth', function () {
    const storageKey = 'dohive.jwt';
    return {
      getToken: function () { return localStorage.getItem(storageKey); },
      setToken: function (t) { localStorage.setItem(storageKey, t); },
      clear: function () { localStorage.removeItem(storageKey); }
    };
  });

  app.factory('Api', function ($http, Auth) {
    function authHeaders() {
      const token = Auth.getToken();
      return token ? { Authorization: 'Bearer ' + token } : {};
    }
    function normalizeDateOut(d) {
      if (!d) return d;
      const s = String(d).trim();
      // Convert dd/mm/yyyy or dd-mm-yyyy to yyyy-mm-dd
      if (s.length >= 10 && (s[2] === '/' || s[2] === '-') && (s[5] === '/' || s[5] === '-')) {
        const sep = s[2];
        const [dd, mm, yy] = s.slice(0,10).split(sep);
        if (yy && yy.length === 4) return yy + '-' + mm + '-' + dd;
      }
      return s.slice(0,10);
    }
    return {
      login: function (email, password) {
        return $http.post(API_BASE + '/auth/login', { email: email, password: password });
      },
      signup: function (name, email, password) {
        return $http.post(API_BASE + '/auth/signup', { name: name, email: email, password: password });
      },
      listTodos: function () {
        return $http.get(API_BASE + '/todos', { headers: authHeaders() });
      },
      createTodo: function (todo) {
        const payload = Object.assign({}, todo, { due_date: normalizeDateOut(todo.due_date) });
        return $http.post(API_BASE + '/todos', payload, { headers: authHeaders() });
      },
      updateTodo: function (id, updates) {
        const payload = Object.assign({}, updates, { due_date: normalizeDateOut(updates.due_date) });
        return $http.put(API_BASE + '/todos/' + id, payload, { headers: authHeaders() });
      },
      deleteTodo: function (id) {
        return $http.delete(API_BASE + '/todos/' + id, { headers: authHeaders() });
      },
      todaySummary: function () {
        return $http.get(API_BASE + '/todos/summary/today', { headers: authHeaders() });
      },
      getTodosByDate: function (date) {
        return $http.get(API_BASE + '/todos/date/' + date, { headers: authHeaders() });
      },
      getTodosByDateRange: function (startDate, endDate) {
        return $http.get(API_BASE + '/todos/range/' + startDate + '/' + endDate, { headers: authHeaders() });
      }
    };
  });

  app.controller('AuthController', function ($window, Auth, Api) {
    const vm = this;
    vm.loading = false;
    vm.error = '';

    vm.login = function () {
      vm.loading = true; vm.error = '';
      Api.login(vm.email, vm.password).then(function (res) {
        Auth.setToken(res.data.token);
        $window.location.href = 'main.html';
      }).catch(function (err) {
        vm.error = (err.data && err.data.error) || 'Login failed';
      }).finally(function(){ vm.loading = false; });
    };

    vm.signup = function () {
      vm.loading = true; vm.error = '';
      Api.signup(vm.name, vm.email, vm.password).then(function (res) {
        Auth.setToken(res.data.token);
        $window.location.href = 'main.html';
      }).catch(function (err) {
        vm.error = (err.data && err.data.error) || 'Signup failed';
      }).finally(function(){ vm.loading = false; });
    };
  });

  app.controller('MainController', function ($window, Auth, Api) {
    const vm = this;
    vm.todos = [];
    vm.form = { title: '', description: '', due_date: '', due_time: '' };
    vm.summary = null;
    vm.editing = null; // holds a copy of the todo being edited

    function ensureAuth() {
      if (!Auth.getToken()) { $window.location.href = 'login.html'; }
    }
    ensureAuth();

    function loadTodos() {
      Api.listTodos().then(function (res) {
        // Force missed recompute on client to be safe
        const now = new Date();
        const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        vm.todos = res.data.map(function(t){
          if (!t.completed && t.due_date) {
            const s = String(t.due_date).slice(0,10);
            const parts = s.split('-');
            let due = null;
            if (parts.length === 3) {
              due = new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
            }
            if (due && due < todayMid) t.missed = true;
          }
          return t;
        });
      });
    }
    function loadSummary() {
      Api.todaySummary().then(function (res) { vm.summary = res.data; });
    }
    loadTodos();
    loadSummary();

    vm.addTodo = function () {
      if (!vm.form.title) { return; }
      const payload = {
        title: vm.form.title,
        description: vm.form.description,
        due_date: vm.form.due_date,
        due_time: vm.form.due_time
      };
      Api.createTodo(payload).then(function (res) {
        vm.todos.unshift(res.data);
        vm.form = { title: '', description: '', due_date: '', due_time: '' };
        loadSummary();
        notifySync();
      });
    };

    vm.toggleCompleted = function (t) {
      Api.updateTodo(t.id, { completed: t.completed }).then(function (res) {
        Object.assign(t, res.data);
        loadSummary();
        notifySync();
      });
    };

    vm.removeTodo = function (t) {
      Api.deleteTodo(t.id).then(function () {
        vm.todos = vm.todos.filter(function (x) { return x.id !== t.id; });
        loadSummary();
        notifySync();
      });
    };

    vm.startEdit = function (t) {
      vm.editing = {
        id: t.id,
        title: t.title,
        description: t.description,
        due_date: t.due_date,
        due_time: t.due_time,
        completed: t.completed
      };
    };

    vm.cancelEdit = function () { vm.editing = null; };

    vm.saveEdit = function () {
      if (!vm.editing) return;
      const updates = {
        title: vm.editing.title,
        description: vm.editing.description,
        due_date: vm.editing.due_date,
        due_time: vm.editing.due_time,
        completed: vm.editing.completed
      };
      Api.updateTodo(vm.editing.id, updates).then(function (res) {
        const idx = vm.todos.findIndex(function(x){ return x.id === vm.editing.id; });
        if (idx !== -1) { vm.todos[idx] = res.data; }
        vm.editing = null;
        loadSummary();
        notifySync();
      });
    };

    vm.refreshSummary = function () { loadSummary(); };

    vm.logout = function () { Auth.clear(); $window.location.href = 'login.html'; };

    vm.formatDate = function (isoDate) {
      if (!isoDate) return '';
      // isoDate expected 'YYYY-MM-DD'
      const s = String(isoDate).slice(0, 10);
      const [y, m, d] = s.split('-');
      if (!y || !m || !d) return s;
      return d + '/' + m + '/' + y;
    };

    // Listen for calendar updates (BroadcastChannel + storage fallback)
    (function(){
      let ch = null;
      try { ch = new BroadcastChannel('dohive-sync'); } catch(e) { ch = null; }
      if (ch) {
        ch.onmessage = function(){ loadTodos(); loadSummary(); };
      }
      window.addEventListener('storage', function (e) {
        if (e.key === 'dohive.sync') { loadTodos(); loadSummary(); }
      });
    })();
  });

  app.controller('CalendarController', function ($window, Auth, Api, $scope) {
    const vm = this;
    vm.currentDate = new Date();
    vm.calendarDays = [];
    vm.selectedDate = null;
    vm.selectedDateTodos = [];
    vm.editingTodo = null;
    vm.newTodo = { title: '', description: '', due_date: '', due_time: '' };

    function ensureAuth() {
      if (!Auth.getToken()) { $window.location.href = 'login.html'; }
    }
    ensureAuth();

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function formatDate(date) {
      const y = date.getFullYear();
      const m = pad2(date.getMonth() + 1);
      const d = pad2(date.getDate());
      return y + '-' + m + '-' + d; // local date, no timezone shift
    }

    function formatDateDisplay(date) {
      return date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }

    vm.formatDate = function(isoDate) {
      if (!isoDate) return '';
      const s = String(isoDate).slice(0,10);
      const [y,m,d] = s.split('-');
      if (!y||!m||!d) return s;
      return d + '/' + m + '/' + y;
    };

    function getDaysInMonth(date) {
      return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    function getFirstDayOfMonth(date) {
      return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    }

    function generateCalendarDays() {
      const year = vm.currentDate.getFullYear();
      const month = vm.currentDate.getMonth();
      const daysInMonth = getDaysInMonth(vm.currentDate);
      const firstDay = getFirstDayOfMonth(vm.currentDate);
      const today = new Date();
      
      vm.calendarDays = [];
      
      // Previous month days
      const prevMonth = new Date(year, month - 1, 0);
      const prevMonthDays = prevMonth.getDate();
      for (let i = firstDay - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        vm.calendarDays.push({
          dayNumber: day,
          date: new Date(year, month - 1, day),
          isCurrentMonth: false,
          isToday: false,
          isSelected: false,
          todoCount: 0,
          completedCount: 0,
          overdueCount: 0,
          todoSummary: ''
        });
      }
      
      // Current month days
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const isToday = date.toDateString() === today.toDateString();
        vm.calendarDays.push({
          dayNumber: day,
          date: date,
          isCurrentMonth: true,
          isToday: isToday,
          isSelected: false,
          todoCount: 0,
          completedCount: 0,
          overdueCount: 0,
          todoSummary: ''
        });
      }
      
      // Next month days
      const remainingDays = 42 - vm.calendarDays.length; // 6 weeks * 7 days
      for (let day = 1; day <= remainingDays; day++) {
        vm.calendarDays.push({
          dayNumber: day,
          date: new Date(year, month + 1, day),
          isCurrentMonth: false,
          isToday: false,
          isSelected: false,
          todoCount: 0,
          completedCount: 0,
          overdueCount: 0,
          todoSummary: ''
        });
      }
      
      loadTodosForCalendar();
    }

    function loadTodosForCalendar() {
      if (vm.calendarDays.length === 0) return;
      
      const firstDay = vm.calendarDays[0].date;
      const lastDay = vm.calendarDays[vm.calendarDays.length - 1].date;
      const startDate = formatDate(firstDay);
      const endDate = formatDate(lastDay);
      
      Api.getTodosByDateRange(startDate, endDate).then(function (res) {
        const todos = res.data;
        
        // Group todos by date
        const todosByDate = {};
        todos.forEach(todo => {
          const todoDate = todo.due_date || formatDate(new Date(todo.created_at));
          if (!todosByDate[todoDate]) {
            todosByDate[todoDate] = [];
          }
          todosByDate[todoDate].push(todo);
        });
        
        // Update calendar days with todo data
        vm.calendarDays.forEach(day => {
          const dayDate = formatDate(day.date);
          const dayTodos = todosByDate[dayDate] || [];
          
          day.todoCount = dayTodos.length;
          day.completedCount = dayTodos.filter(t => t.completed).length;
          day.overdueCount = dayTodos.filter(t => {
            if (t.completed) return false;
            const now = new Date();
            let dueDate;
            if (t.due_date) {
              const [yy, mm, dd] = String(t.due_date).slice(0,10).split('-').map(Number);
              dueDate = new Date(yy, (mm || 1) - 1, dd || 1); // local midnight
            } else {
              dueDate = new Date(t.created_at); // ISO timestamp
            }
            const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return dueDate < todayLocal;
          }).length;
          
          if (day.todoCount > 0) {
            const completed = day.completedCount;
            const total = day.todoCount;
            day.todoSummary = `${completed}/${total} completed`;
          }
        });
      }).catch(function (err) {
        console.error('Error loading todos for calendar:', err);
      });
    }

    vm.previousMonth = function () {
      vm.currentDate.setMonth(vm.currentDate.getMonth() - 1);
      generateCalendarDays();
    };

    vm.nextMonth = function () {
      vm.currentDate.setMonth(vm.currentDate.getMonth() + 1);
      generateCalendarDays();
    };

    vm.selectDate = function (day) {
      if (!day.isCurrentMonth) return;
      
      // Clear previous selection
      vm.calendarDays.forEach(d => d.isSelected = false);
      day.isSelected = true;
      
      vm.selectedDate = day.date;
      vm.selectedDateFormatted = formatDateDisplay(day.date);
      vm.newTodo.due_date = formatDate(day.date);
      
      loadTodosForDate(day.date);
      
      // Show modal
      const modal = new bootstrap.Modal(document.getElementById('todoModal'));
      modal.show();
    };

    function loadTodosForDate(date) {
      const dateStr = formatDate(date);
      Api.getTodosByDate(dateStr).then(function (res) {
        vm.selectedDateTodos = res.data;
      }).catch(function (err) {
        console.error('Error loading todos for date:', err);
        vm.selectedDateTodos = [];
      });
    }

    vm.addTodo = function () {
      if (!vm.newTodo.title) return;
      
      const todoData = {
        title: vm.newTodo.title,
        description: vm.newTodo.description,
        due_date: vm.newTodo.due_date,
        due_time: vm.newTodo.due_time
      };
      
      Api.createTodo(todoData).then(function (res) {
        vm.selectedDateTodos.unshift(res.data);
        vm.newTodo = { title: '', description: '', due_date: vm.newTodo.due_date, due_time: '' };
        loadTodosForCalendar(); // Refresh calendar
        notifySync();
      }).catch(function (err) {
        console.error('Error creating todo:', err);
      });
    };

    vm.toggleCompleted = function (todo) {
      Api.updateTodo(todo.id, { completed: todo.completed }).then(function (res) {
        Object.assign(todo, res.data);
        loadTodosForCalendar(); // Refresh calendar
        notifySync();
      }).catch(function (err) {
        console.error('Error updating todo:', err);
        todo.completed = !todo.completed; // Revert on error
      });
    };

    vm.editTodo = function (todo) {
      vm.editingTodo = angular.copy(todo);
      const modal = new bootstrap.Modal(document.getElementById('editTodoModal'));
      modal.show();
    };

    vm.updateTodo = function () {
      if (!vm.editingTodo.title) return;
      
      const updates = {
        title: vm.editingTodo.title,
        description: vm.editingTodo.description,
        completed: vm.editingTodo.completed,
        due_date: vm.editingTodo.due_date,
        due_time: vm.editingTodo.due_time
      };
      
      Api.updateTodo(vm.editingTodo.id, updates).then(function (res) {
        // Update in selected date todos
        const index = vm.selectedDateTodos.findIndex(t => t.id === vm.editingTodo.id);
        if (index !== -1) {
          vm.selectedDateTodos[index] = res.data;
        }
        
        vm.editingTodo = null;
        const modal = bootstrap.Modal.getInstance(document.getElementById('editTodoModal'));
        modal.hide();
        
        loadTodosForCalendar(); // Refresh calendar
        notifySync();
      }).catch(function (err) {
        console.error('Error updating todo:', err);
      });
    };

    vm.deleteTodo = function (todo) {
      if (!confirm('Are you sure you want to delete this todo?')) return;
      
      Api.deleteTodo(todo.id).then(function () {
        vm.selectedDateTodos = vm.selectedDateTodos.filter(t => t.id !== todo.id);
        loadTodosForCalendar(); // Refresh calendar
        notifySync();
      }).catch(function (err) {
        console.error('Error deleting todo:', err);
      });
    };

    vm.logout = function () { 
      Auth.clear(); 
      $window.location.href = 'login.html'; 
    };

    // Listen for changes from todos page
    try {
      const ch = new BroadcastChannel('dohive-sync');
      ch.onmessage = function () {
        generateCalendarDays();
        if (vm.selectedDate) { loadTodosForDate(vm.selectedDate); }
        $scope.$applyAsync();
      };
    } catch (e) {
      // BroadcastChannel not available; storage handler below will cover
    }
    window.addEventListener('storage', function (e) {
      if (e.key === 'dohive.sync') {
        generateCalendarDays();
        if (vm.selectedDate) { loadTodosForDate(vm.selectedDate); }
        $scope.$applyAsync();
      }
    });

    // Initialize
    vm.currentMonthYear = vm.currentDate.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long' 
    });
    generateCalendarDays();
  });
})();




