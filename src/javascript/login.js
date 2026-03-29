const loginForm = document.getElementById('login-form');
loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (email && password) {
        console.log("Autenticando...");
        window.location.href = "../screens/inicial.html"; 
    } else {
            alert("Por favor, preencha todos os campos.");
        }
    });
